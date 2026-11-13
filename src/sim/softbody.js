// XPBD tetrahedral soft body with stable Neo-Hookean constraints
// (Macklin & Müller 2021), rigid-motion-preserving damping, ground/arena
// contact with friction, inter-piece contact, grabbing, embedded rigid
// segments (nails) and a per-vertex temperature field.

import { buildCubeMesh, roundBoxSDF, roundBoxNormal, shapeSDF, shapeNormal, CRIMPS, crimpSharp } from './mesh.js';

export const FACES = [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]];
export const TAG_FRESH = 0;
export const TAG_EXTERIOR = 1;
export const TAG_MELT = 2; // (a surface the torch melted: smooth, glossy - like the skin)

const DEFAULTS = {
  size: 1,
  res: 11,
  bevel: 0.13,
  density: 1,
  mu: 170, // shear modulus (sets wobble frequency)
  lambdaRatio: 24, // lambda / mu (near-incompressible)
  gravity: -22,
  substeps: 12,
  damping: 1.7, // decay rate of non-rigid velocity (1/s)
  airDrag: 0.05,
  friction: 0.85,
  bounce: -1, // rebound/impact speed ratio for floor & wall hits (-1 = natural)
  arenaRadius: 2.35,
  box: false, // (the glass room: the walls square, half its width arenaRadius out)
  ceiling: 4.2,
  maxSpeed: 45,
  collide: true,
  selfCollide: true, // a piece's surface against the rest of its own body (folds, hinged flaps)
  rigidity: 0, // 0..1: pulled toward its rest shape as a whole (see _solveRigidity) - 0 none, 1 near rigid
  grabK: 1, // how hard a hand pulls (reach and stiffness; Settings > Lab > Hand strength)
  contactGrip: 1, // friction between pieces, x the base 0.5 (Settings > Lab > Jelly on jelly)
};

// Several cubes of different stuff can share the body: every vertex and tet
// knows its cube (vCube, tCube) and each cube has its own material (setCube).
// Each cube's rest shape sits apart from the others' in rest space (REST_STEP
// along x), so nothing that works in rest space mixes them up.
export const MAX_CUBES = 8;
export const REST_STEP = 10;
// (a thin firm shell's spring to its shape, ultrathin rubber's: how quick, alone - see SoftBody._shellSpring)
const SHELL_HZ = 5.5;
// (a hollow's skin left short of its shape by its carving - a thin wall's corners, one diagonal set of them 2-4
// cm; a medium wall's edges, 4: their tets would have been squashed flat - is drawn out to it, as far as this,
// and its liquid let fill it: see vShort, JellyView._buildSmooth, Fluid._jellyAt. A dished face's 8 moves 5.)
export const HOLLOW_SHORT = 0.05;
// A splat - a cube with next to no bounce (under SPLAT_E) come down hard: squashed as far as it goes, its jiggle
// damped hard (SPLAT_D a second at first, fading over SPLAT_T) - it oozes back up, not springs - and its feet held
// to the floor meanwhile as hard as the stickiest's are (see _dampPieces, _solveBounds)
const SPLAT_E = 0.3, SPLAT_D = 30, SPLAT_T = 0.7;
// Stuck to the floor (a sticky cube's tack - see setCube - or a splat's): held there by up to STICK_A m/s^2 of pull
// at its stickiest - a vertex pulled up harder than that a substep lets go; held against a pull, its hold gives at
// PEEL_RATE a second as hard as it's pulled (a steady pull peels it, from its edges in, given time). (A slime's,
// two-thirds of that, pulled up by its top: stretched to 1.7 times its height and peeling from its edges in, it
// pops free. At a third of it, it came up as soon as a cube that didn't stick did)
const STICK_A = 4000, PEEL_RATE = 1.6;
// Squashed by a landing out of the air, or by the air falling: not a tangle for LAND_CALM s after, nor while it's
// windy (see _tangleCheck) - sprung back to its shape as made, a splatted pudding popped back up a cube a moment
// after landing, and a falling one reset in mid-air and spread again: the twerk, again
const LAND_CALM = 2;

// How soft, at the least, the tets' shape and volume terms stay - as a share
// of hard (a full correction in one substep): see _solveTets. A tet of the
// cube as it was made (its bevels' squashed ones are up to ~3x as hard as a
// typical one of it) at least DEV_SOFT of its own hard: else light, stiff
// stuff settled ribbed - edges scalloped, faces dented, 5 mm deep. Harder
// ones - the slivers cuts leave - no softer than DEV_CAP times a typical
// tet of the cube's own (cHardTyp), and at least DEV_SOFT_MIN of their own:
// held to 12 of their own hard, the tets round a few bullet holes went to
// mush and the hand couldn't lift the cube; at under 3, they crush
// themselves inside out and diced pieces blow up into spikes.
const DEV_SOFT = 12;
const DEV_CAP = 60;
const DEV_SOFT_MIN = 3;
const VOL_SOFT = 0.25;
// (a cube full of liquid's cut, part way through: its two sides held to each other - see _solveStitches -
// within this much more than their rest gap (m), pulled back over this long (s))
const STITCH_SLACK = 0.012;
const STITCH_T = 0.05;
// (squeezed - see cPress - a slit's lips pushed apart this far, m a share)
const STITCH_OPEN = 0.8;

function growArr(a, n, C) {
  const b = new C(n);
  if (a) b.set(a.length > n ? a.subarray(0, n) : a);
  return b;
}

// V8 keeps a field that has only ever held whole numbers as a small integer;
// the first fraction stored in it then changes the hidden class of every
// object of that kind, throwing away all the code optimised for them (a
// stutter the first time, say, the mallet sets a fractional damping). Fields
// that will hold fractions get one straight away.
function asFloat(o, keys) {
  for (const k of keys) {
    const v = o[k];
    o[k] = 0.5;
    o[k] = v;
  }
  return o;
}
// The rotation part of A (3x3, A[i*3+j]): Muller et al. 2016 - q (a unit
// quaternion, x y z w) iterated toward it from where it was; R (A's layout)
// out. Robust through flips and flat shapes, and a few rounds from a warm q.
export function polarRot(q, A, R, iters) {
  for (let it = 0; ; it++) {
    const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
    R[0] = 1 - 2 * (qy * qy + qz * qz); R[1] = 2 * (qx * qy - qz * qw); R[2] = 2 * (qx * qz + qy * qw);
    R[3] = 2 * (qx * qy + qz * qw); R[4] = 1 - 2 * (qx * qx + qz * qz); R[5] = 2 * (qy * qz - qx * qw);
    R[6] = 2 * (qx * qz - qy * qw); R[7] = 2 * (qy * qz + qx * qw); R[8] = 1 - 2 * (qx * qx + qy * qy);
    if (it === iters) return;
    // omega = sum_j col_j(R) x col_j(A) / |sum_j col_j(R) . col_j(A)|
    let ox = 0, oy = 0, oz = 0, dd = 0;
    for (let j = 0; j < 3; j++) {
      const r0 = R[j], r1 = R[3 + j], r2 = R[6 + j], a0 = A[j], a1 = A[3 + j], a2 = A[6 + j];
      ox += r1 * a2 - r2 * a1; oy += r2 * a0 - r0 * a2; oz += r0 * a1 - r1 * a0;
      dd += r0 * a0 + r1 * a1 + r2 * a2;
    }
    dd = Math.abs(dd) + 1e-12;
    ox /= dd; oy /= dd; oz /= dd;
    const wl = Math.sqrt(ox * ox + oy * oy + oz * oz);
    if (wl < 1e-9) {
      iters = it + 1; // (converged: R is already q's)
      continue;
    }
    const sh = Math.sin(wl / 2) / wl, ch = Math.cos(wl / 2);
    const px = ox * sh, py = oy * sh, pz = oz * sh, pw = ch;
    const nx = pw * qx + px * qw + py * qz - pz * qy, ny = pw * qy - px * qz + py * qw + pz * qx;
    const nz = pw * qz + px * qy - py * qx + pz * qw, nw = pw * qw - px * qx - py * qy - pz * qz;
    const ql = Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw) || 1;
    q[0] = nx / ql; q[1] = ny / ql; q[2] = nz / ql; q[3] = nw / ql;
  }
}

const PIECE_FLOATS = ['air', 'landAt', 'lastVy', 'splatT', 'splatK', 'splatV', 'sleepT', 'rebT', 'impY', 'rebR', 'impR', 'impUx', 'impUz', 'impT', 'impDv', 'foldUntil', 'buzzT', 'buzzA', 'buzzB', 'untangle', 'tangleTouch', 'touchT', 'vib', 'nwT', 'nwV', 'nwU', 'nwN'];
// (piece state a rebuild carries over to an untouched piece: see _buildPieces)
const CARRY = ['air', 'landAt', 'lastVy', 'splatT', 'splatK', 'splatV', 'sleepT', 'asleep', 'rebT', 'impY', 'boosted', 'rebR', 'impR', 'impUx', 'impUz', 'boostedR', 'impPend', 'impT', 'impDv', 'sleepLogMu', 'foldUntil', 'foldAsk', 'buzzT', 'buzzA', 'buzzB', 'tangleN', 'untangle', 'tangleTries', 'tangleTouch', 'touchT', 'hinge', 'gap', 'foldN', 'foldTouch', 'foldGiveUp', 'nwT', 'nwV', 'nwU', 'nwN', 'nwS'];

// (the parts of a step ?stats times: SoftBody.profT, in this order - the
// last, how many substeps)
export const PROF_PHASES = ['pre', 'hash', 'integrate', 'grab', 'tets', 'extra', 'contact', 'bounds', 'velocity', 'post', 'substeps'];
// (a cell, then the 13 of the 26 round it that come after it: each pair of
// neighbouring cells looked at from one of them - see _selfCheck)
const FOLD_GIVE_UP = 8; // (looks - about a second - a piece's folds are tried before they're left be: see _foldCheck)
const HALF27 = [[0, 0, 0]];
for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) if (a * 9 + b * 3 + c > 0) HALF27.push([a, b, c]);

export class SoftBody {
  constructor(opts = {}) {
    this.p = asFloat(Object.assign({}, DEFAULTS, opts), ['rigidity', 'grabK', 'contactGrip', 'airDrag']);
    this.nV = 0;
    this.nT = 0;
    this.vCap = 0;
    this.tCap = 0;
    this.tKs = null; // per tet: stiffness scale, see _computeMass
    this.tLq = null; // per tet: its share of its cube's firmness - a liquid-filled cube's inside next to none: see _liquidTets
    this.tPr = null; // per tet: how much more than its volume it wants (a liquid-filled cube's inside: its skin kept taut)
    this._liqTopo = -1; // (the mesh tLq was made for, and whether a cube's liquid's changed since)
    this._liqDirty = true;
    this._skinT = null; // (scratch for _liquidTets: the skin's tets, its vertices, and which pieces lie open)
    this._skinV = null;
    this._liqOpen = null;
    this._bpNV = 0; // vertex count at the last _buildPieces (0: nothing carries over)
    this._carried = null; // per piece: carried over unchanged by the last rebuild (see _buildPieces)
    // Every field the physics ever sets, here and in this order - each a placeholder of the kind it will hold.
    // One made later (a scratch array first needed at the first landing, grab, cut, fold...) changed the body's
    // shape, and Safari threw away every bit of optimised code shaped to the old one and waited seconds before
    // optimising again: the tets ran 10-20x slow for ~4 s after the first drop landed (an iPhone report, and
    // Playwright's WebKit). Lengths 64/MAX_CUBES: grown where they're used, the same kind of array.
    this._anyRigid = false;
    this._lightBuild = false;
    this._sliverV = null;
    this.cHardTyp = new Float64Array(MAX_CUBES);
    this._vDirty = null;
    this._glue = null;
    this._pressP = new Float64Array(64);
    this._kMu = new Float64Array(MAX_CUBES);
    this._kLam = new Float64Array(MAX_CUBES);
    this._kBoost = new Float64Array(MAX_CUBES);
    this._wEmb = null;
    this._leadP = null;
    this._leadV = null;
    this._foldFound = new Uint8Array(64);
    this._foldDeep = new Uint8Array(64);
    this._tgLook = new Uint8Array(64);
    this._tgOut = new Int32Array(64);
    this._rgAmt = new Float64Array(MAX_CUBES);
    this._rgA = new Float64Array(9);
    this._rgR = new Float64Array(9);
    this._rgHeld = null;
    this._r2Topo = -1;
    this._r2N = 0;
    this._r2On = null;
    this._r2M = null;
    this._r2S = null;
    this._r2L = null;
    this._selfFresh = false;
    this._selfTopo = -1;
    this._selfSig = 0;
    this._nearBox = new Uint8Array(64);
    this._grabbedP = new Uint8Array(64);
    this._allocV(4096);
    this._allocT(16384);
    this.grabs = []; // hands holding the jelly (two fingers: two) - see startGrab
    this.embeds = [];
    this.pushers = []; // moving flat faces pressing into the jelly (mallet head)
    this.attract = null;
    this.gravityScale = 1;
    this.tilt = new Float64Array(2); // (m/s²) sideways pull along x, z: the table tipped (see Tilt)
    this.collisionsEnabled = true;
    this.selfQuietUntil = 0; // (sim time) no self-contact before this: see radialImpulse
    this.topoVersion = 0;
    this.restVersion = 0; // (rest shapes changed in place - the render's rest points to re-read: see easeRest)
    this._restEase = null;
    // (?stats: time spent in each part of a step, ms, added up till read -
    // see PROF_PHASES; null, not timed. Set here so the object keeps its shape.)
    this.profT = null;
    // (bumped when whole cubes - or pieces - come and go and the tets are
    // renumbered: what's anchored by tet index, and not in embeds, re-finds
    // its place - see Bubbles)
    this.cubeVersion = 0;
    this.pieces = [];
    this.time = 0;
    this.hCell = this.p.size / this.p.res;
    this.impacts = []; // impacts this frame, one per piece: {x, y, z, dv, piece, kind, mass, partner} (for audio)
    this._ct = asFloat({ t: -1, f: -1, b0: 0, b1: 0, b2: 0, b3: 0, nx: 0, ny: 0, nz: 0, depth: 0 }, ['b0', 'b1', 'b2', 'b3', 'nx', 'ny', 'nz', 'depth']);
    // Every field this object will ever carry is created here, so its shape
    // never changes later: Safari's JIT throws its optimised code away (and
    // takes seconds to rebuild it) whenever a hot object gains a property.
    this.rebuildMs = 0;
    this.rebuilds = 0;
    this.dampBoost = 1;
    this.dmgHeal = 0; // (s) left of torn ends firming up (tDmg decaying)
    this.calmT = 0; // (s) left of the jiggle damped hard (just torn: the halves settle, not flail)
    // each cube's own shape (see mesh.js shapeSDF, crimp; setShape): its
    // faces dished or bulged (0: flat), its edges' trim - how far it stands
    // out (0: none), every how many cells, which kind (mesh.js CRIMPS)
    this.cBow = new Float64Array(MAX_CUBES);
    this.cLobeA = new Float64Array(MAX_CUBES);
    this.cLobeP = new Float64Array(MAX_CUBES);
    this.cTrimK = new Uint8Array(MAX_CUBES);
    // each cube's material (see setCube; cube 0 starts as p)
    this.cMu = new Float64Array(MAX_CUBES);
    this.cLam = new Float64Array(MAX_CUBES);
    this.cDamp = new Float64Array(MAX_CUBES);
    this.cFric = new Float64Array(MAX_CUBES);
    this.cBounce = new Float64Array(MAX_CUBES);
    this.cTack = new Float64Array(MAX_CUBES); // (0..1: how it sticks to the floor where it's touched it - see _solveBounds)
    this._pTack = new Float64Array(64); // (each piece's, this step: its cube's, or its splat's while that holds)
    this.cRigid = new Float64Array(MAX_CUBES);
    this.cDens = new Float64Array(MAX_CUBES);
    this.cAir = new Float64Array(MAX_CUBES);
    this.cBevel = new Float64Array(MAX_CUBES).fill(this.p.bevel); // (each its own edges)
    this.cN = new Int32Array(MAX_CUBES); // (each one's vertices, built whole)
    // each cube its own size (and so its own mesh resolution: the cells are
    // about the same size in every cube - see App._cells)
    this.cSize = new Float64Array(MAX_CUBES).fill(this.p.size);
    this.cRes = new Int32Array(MAX_CUBES).fill(this.p.res);
    this.cH = new Float64Array(MAX_CUBES).fill(this.p.size / this.p.res);
    // one cube re-cubing on its own (see Healer.start's only): its gravity
    // and damping its own, and it passes through everything meanwhile
    this.cGrav = new Float64Array(MAX_CUBES).fill(1);
    // (the air on each cube falling fast: how hard it presses on a face for its speed into it - 0, none: see
    // setWind, _wind)
    this.cWind = new Float64Array(MAX_CUBES);
    this._anyWind = false;
    this._wSum = new Float64Array(MAX_CUBES * 6); // (a substep's: each windy cube's skin's area, its speed through the air, its push - see _wind)
    this.cBoost = new Float64Array(MAX_CUBES).fill(1);
    // full of liquid (0/1), how thick that is (0 water .. 1 near solid), how thick its skin (0 ultrathin .. 1
    // thick): see _liquidTets
    this.cLiq = new Uint8Array(MAX_CUBES);
    this.cVisc = new Float64Array(MAX_CUBES).fill(0.15);
    this.cTens = new Float64Array(MAX_CUBES).fill(0.5); // (its liquid's surface tension: see Fluid._wallFill)
    this.cSkin = new Float64Array(MAX_CUBES).fill(0.5);
    // (and a cube full of liquid is a shell, once its inside's been let out to be real liquid - the Fluid's: see
    // Spill: how full it was filled, whether it's hollow yet, and its hollow while it's sealed - see
    // _solveCavities)
    this.cFill = new Float64Array(MAX_CUBES).fill(1);
    this.cHollow = new Uint8Array(MAX_CUBES);
    this.cav = new Array(MAX_CUBES).fill(null);
    // (and where its hollow is in it as made - a box, rest coordinates: lo xyz, hi xyz - see Fluid._collide; and
    // the liquid it was filled with, its drops marked so: gone - the cube taken out or made afresh - they go too)
    this.cHole = new Float64Array(MAX_CUBES * 6);
    this.cHid = new Int32Array(MAX_CUBES);
    // (cut into: how hard its liquid's squeezed - see Fluid._pressures, _solveStitches)
    this.cPress = new Float32Array(MAX_CUBES);
    this.ghostCube = -1;
    for (let k = 0; k < MAX_CUBES; k++) this.setCube(k, this.p, true);
    this.heatActive = false;
    this._heatResidual = 0;
    this.weld = null; // set by the heal: distances to the healed seams
    this.fill = null; // set by the heal: what was missing, rising to fill its holes (see JellyView)
    // (the partners across a liquid cube's slits, pairs of vertices - see _solveStitches - as of a topology)
    this._stitch = new Int32Array(64);
    this._stN = 0;
    this._stTopo = -1;
    this.anyAwake = true;
    // the piece-contact candidates cover _hashSpan seconds of motion from
    // when they were found (_hashAge ago); short frames reuse them
    this._hashSpan = 1 / 60;
    this._hashAge = 0;
    this._hashTopo = -1;
    this._hashDirty = true;
    this._hMask = 0;
    this._grabPress = 0;
    this._anyContact = false;
    this._gap = 0;
    this._fSelf = false;
    this.topoStale = false; // a light rebuild done, the full one still owed (see rebuildLight)
    this._tgVersion = -1; // (surface edges for _tangleCount, per topology)
    this._tgEdges = null;
    this._tgBox = null;
    this._tgStamp = null;
    this._tgSt = 0;
    this._pass = 0;
    this._fStamp = 0;
    this._nHTets = 0;
    this._nProbeV = 0;
    this._nProbeF = 0;
    this._warmVersion = -1;
    // derived from the topology (see rebuild)
    this.nF = 0;
    this.esc = null;
    this.vtStart = null;
    this.vtList = null;
    this.nbStart = null;
    this.nbList = null;
    this.sTri = null;
    this.sTet = null;
    this.sTag = null;
    this.sRestN = null;
    this.sHollow = null; // (each face: on a rounded hollow's skin (2) or not - see _buildRenderClusters)
    this.vShort = null; // (each vertex on one: how far short of its shape as drawn it was carved, m; past it, -)
    this.tetBoundary = null;
    this.nextBoundary = null;
    this.vfStart = null;
    this.vfList = null;
    this._fSeen = null;
    this._fGeo = null;
    this._fGeoStamp = null;
    this.rCount = 0;
    this.rSim = null;
    this.rTag = null;
    this.rIndex = null;
    this.rFaceOrder = null;
    this.pieceRanges = null;
    this._rg = null;
    // solver scratch (allocated on first use)
    this._awake = null;
    this._imp = null;
    this._impPartner = null;
    this._pmu = null;
    this._tmpTemp = null;
    this._pbb = null;
    this._pVel = null;
    this._pMass = null;
    this._pcs = null;
    this._sweep = null;
    this._disp = null;
    this._tStat = null;
    this._sfKey = null;
    this._sfVal = null;
    this._selfOK = null;
    this._hood = null;
    this._tSurf = null;
    this._surfV = null;
    this._nSurfV = 0;
    this._selfFlag = null;
    this._selfD = null; // (each flagged one: how near the nearest other part of its own surface came, squared)
    this._selfHist = null;
    this._selfFaces = true; // (face centres probe their own piece too - not when it's busy: see _selfCheck)
    this._svStart = null;
    this._svFill = null;
    this._svList = null;
    this._hoodStamp = 0;
    this._foldClock = 0; // (s) since the last look for folds
    this._tangleClock = 0; // (s) since the last look for surfaces passed through themselves
    this._tangleNext = 0; // (the next piece to look at)
    this._foldNext = 0; // (the next piece to look at)
    this._foldUntil = null; // per vertex: sim time till which it is held as folded in
    this._foldLook = null;
    this._fgCount = null;
    this._fgEnt = null;
    this._fgBox = null;
    this._pieceActive = null;
    this._ptS = null;
    this._hCount = null;
    this._hEntries = null;
    this._hFill = null;
    this._hRanges = null;
    this._hTets = null;
    this._tBox0 = null;
    this._tBoxNow = null;
    this._tBoxStamp = null;
    this._tStamp = null;
    this._cList = null;
    this._skip = null;
    this._probeV = null;
    this._probeF = null;
    this._probeSeen = null;
    this._pcStart = null;
    this._pcEnd = null;
    this._pRel = null;
    this._vcS = null;
    this._vcE = null;
    this._vcR = null;
    this._fcS = null;
    this._fcE = null;
    this._fcR = null;
    this._wtV = null;
    this._wfV = null;
    this._wtF = null;
    this._wfF = null;
    this._pi3 = new Int32Array(3);
    this._pw3 = new Float64Array(3);
    this._ti4 = new Int32Array(4);
    this._tb4 = new Float64Array(4);
    this._fq = asFloat({ ok: false, dist: 0, prev: 0, nx: 0, ny: 0, nz: 0, on: false, crossS: Infinity }, ['dist', 'prev', 'nx', 'ny', 'nz']);
    asFloat(this, ['time', 'gravityScale', 'rebuildMs', 'dampBoost', 'dmgHeal', 'calmT', '_heatResidual', '_hashAge', '_grabPress', '_gap', '_foldClock', '_tangleClock']);
  }

  // ---------------------------------------------------------------- storage
  _allocV(cap) {
    this.x = growArr(this.x, cap * 3, Float64Array);
    this.px = growArr(this.px, cap * 3, Float64Array);
    this.v = growArr(this.v, cap * 3, Float64Array);
    this.X = growArr(this.X, cap * 3, Float64Array);
    this.w = growArr(this.w, cap, Float64Array);
    this.m = growArr(this.m, cap, Float64Array);
    this.temp = growArr(this.temp, cap, Float32Array);
    this.glow = growArr(this.glow, cap, Float32Array);
    this.vPiece = growArr(this.vPiece, cap, Int32Array);
    this.vCube = growArr(this.vCube, cap, Uint8Array);
    this.vTag = growArr(this.vTag, cap, Uint16Array); // (0, or the gel gun's blob it is: see addBlob)
    this.alive = growArr(this.alive, cap, Uint8Array);
    this.melt = growArr(this.melt, cap, Uint8Array); // (on a surface the torch melted)
    this.dust = growArr(this.dust, cap, Float32Array); // (powder on it, 0..1: see Flour)
    // (and what it is: its colour, sparkle and multi, each times the amount
    // - so mixed, they average by how much of each - see Flour.coat)
    this.coat = growArr(this.coat, cap * 5, Float32Array);
    this.fpen = growArr(this.fpen, cap, Float32Array); // floor push-out this substep
    this.wpen = growArr(this.wpen, cap, Float32Array); // wall push-out this substep
    this.stick = growArr(this.stick, cap, Float32Array); // (stuck to the floor: its hold, 0..1 - see _solveBounds)
    this.slitOf = growArr(this.slitOf, cap, Int32Array); // (1 + the vertex across a slit from it - a partial cut's - or 0: see cutBody, Spill)
    this.vCap = cap;
  }

  _allocT(cap) {
    this.T = growArr(this.T, cap * 4, Int32Array);
    this.B = growArr(this.B, cap * 9, Float64Array);
    this.vol0 = growArr(this.vol0, cap, Float64Array);
    this.tPiece = growArr(this.tPiece, cap, Int32Array);
    this.tCube = growArr(this.tCube, cap, Uint8Array);
    this.tVS = growArr(this.tVS, cap, Float32Array);
    this.tMu = growArr(this.tMu, cap, Float32Array);
    this.tKs = growArr(this.tKs, cap, Float32Array);
    const lq = this.tLq ? this.tLq.length : 0;
    this.tLq = growArr(this.tLq, cap, Float32Array);
    this.tLq.fill(1, lq); // (firm all through till _liquidTets says otherwise)
    this.tPr = growArr(this.tPr, cap, Float32Array);
    this.tDmg = growArr(this.tDmg, cap, Float32Array); // (0..1: torn that far - softer, see _solveTets; cleared on a rebuild)
    this.tCap = cap;
  }

  ensureV(n) {
    if (n > this.vCap) this._allocV(Math.max(n, this.vCap * 2));
  }

  ensureT(n) {
    if (n > this.tCap) this._allocT(Math.max(n, this.tCap * 2));
  }

  addVertex(x, y, z, X, Y, Z, vx = 0, vy = 0, vz = 0, temp = 0, cube = 0, tag = 0) {
    const i = this.nV++;
    this.ensureV(this.nV);
    this.vCube[i] = cube;
    this.vTag[i] = tag;
    this.slitOf[i] = 0;
    const o = i * 3;
    this.x[o] = x; this.x[o + 1] = y; this.x[o + 2] = z;
    this.px[o] = x; this.px[o + 1] = y; this.px[o + 2] = z;
    this.v[o] = vx; this.v[o + 1] = vy; this.v[o + 2] = vz;
    this.X[o] = X; this.X[o + 1] = Y; this.X[o + 2] = Z;
    this.temp[i] = temp;
    this.glow[i] = 0;
    this.alive[i] = 1;
    this.melt[i] = 0;
    this.dust[i] = 0;
    this.coat.fill(0, i * 5, i * 5 + 5);
    return i;
  }

  // ---------------------------------------------------------------- setup
  // Cube k's own shape - its faces' bow, its edges' trim (A 0: none; m:
  // every how many cells; kind: mesh.js CRIMPS) - for the next time it's
  // built.
  setShape(k, bow, A, m, kind = 'scallop') {
    this.cBow[k] = Number.isFinite(bow) ? bow : 0;
    this.cLobeA[k] = A > 0 ? A : 0;
    this.cLobeP[k] = m > 0 ? m : 0;
    this.cTrimK[k] = Math.max(0, CRIMPS.indexOf(kind));
  }

  // (cube k's shape as it's built: null - a plain rounded box - or { bow,
  // A, m }: see mesh.js buildCubeMesh)
  shapeOf(k) {
    if (!(this.cBow[k] || this.cLobeA[k] > 0)) return null;
    return { bow: this.cBow[k], A: this.cLobeA[k], m: this.cLobeP[k] || 2, kind: CRIMPS[this.cTrimK[k]] || 'scallop' };
  }

  // (...and as a shape - its skin's: only a bow is - the crimp's in its
  // points, not its shape: null, the plain rounded box, or { bow })
  formOf(k) {
    return this.cBow[k] ? { bow: this.cBow[k] } : null;
  }

  // A cube full of liquid's wall: how thick (see Spill._hollow) - and its hollow's rounding as it's drawn, its
  // edges' radius: the cube's less the wall, or a third of a tet's cell if that's less - its tets can't make it
  // any sharper. (A sharp box - a thin wall's sharp-edged cube's, a thick one's - came out of them crimped, one
  // diagonal set of its corners one way and the other the other.) Its shape: the cube's own with its edges that
  // much rounder (hollowBevel), its wall's thickness in.
  wallTh(k) {
    const sk = Math.min(1, Math.max(0, this.cSkin[k]));
    return this.cSize[k] * (sk <= 0.5 ? 0.05 + 0.08 * sk : 0.09 + 0.18 * (sk - 0.5));
  }
  hollowRound(k) {
    return Math.max(this.cBevel[k] - this.wallTh(k), 0.3 * this.cH[k]);
  }
  hollowBevel(k) {
    return this.wallTh(k) + this.hollowRound(k);
  }

  loadCube(ox = 0, oy = 0, oz = 0, yaw = 0) {
    this.cubeVersion++;
    if (this.slitOf) this.slitOf.fill(0);
    this.cHollow.fill(0);
    this.cav.fill(null);
    this.cHid.fill(0);
    this.cPress.fill(0);
    this.cWind.fill(0);
    this._anyWind = false;
    this.cBevel[0] = this.p.bevel;
    const mesh = buildCubeMesh(this.p.res, this.p.size, this.p.bevel, this.shapeOf(0));
    this.cN[0] = mesh.nV;
    this.cSize[0] = this.p.size;
    this.cRes[0] = this.p.res;
    this.cH[0] = mesh.h;
    this.hCell = mesh.h;
    this.nV = 0;
    this.ensureV(mesh.nV);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const half = this.p.size / 2;
    for (let i = 0; i < mesh.nV; i++) {
      const X = mesh.pos[i * 3], Y = mesh.pos[i * 3 + 1], Z = mesh.pos[i * 3 + 2];
      this.addVertex(ox + c * X + s * Z, oy + Y + half, oz - s * X + c * Z, X, Y, Z);
    }
    this.nT = mesh.nT;
    this.ensureT(this.nT);
    this.T.set(mesh.tets);
    this.tVS.fill(1, 0, this.nT);
    this.tMu.fill(1, 0, this.nT);
    this.embeds.length = 0;
    this.grabs.length = 0;
    this._bpNV = 0;
    this.rebuild();
  }

  // Another cube (k: its slot), its bottom at oy, turned by yaw: added to
  // what's there (rebuild() after). Its rest shape is offset k * REST_STEP.
  // (size, res: its own - see cSize)
  addCube(k, ox = 0, oy = 0, oz = 0, yaw = 0, bevel = this.p.bevel, size = this.p.size, res = this.p.res) {
    this.cubeVersion++;
    if (this.slitOf) this.slitOf.fill(0, this.nV);
    this.cHollow[k] = 0;
    this.cav[k] = null;
    this.cHid[k] = 0;
    this.cPress[k] = 0;
    this.cBevel[k] = bevel;
    const mesh = buildCubeMesh(res, size, bevel, this.shapeOf(k));
    this.cN[k] = mesh.nV;
    this.cSize[k] = size;
    this.cRes[k] = res;
    this.cH[k] = mesh.h;
    this.hCell = mesh.h;
    const base = this.nV, tBase = this.nT;
    const c = Math.cos(yaw), s = Math.sin(yaw), half = size / 2, R = k * REST_STEP;
    this.ensureV(base + mesh.nV);
    for (let i = 0; i < mesh.nV; i++) {
      const X = mesh.pos[i * 3], Y = mesh.pos[i * 3 + 1], Z = mesh.pos[i * 3 + 2];
      this.addVertex(ox + c * X + s * Z, oy + Y + half, oz - s * X + c * Z, X + R, Y, Z, 0, 0, 0, 0, k);
    }
    this.nT = tBase + mesh.nT;
    this.ensureT(this.nT);
    for (let t = 0; t < mesh.nT * 4; t++) this.T[tBase * 4 + t] = mesh.tets[t] + base;
    this.tVS.fill(1, tBase, this.nT);
    this.tMu.fill(1, tBase, this.nT);
    this._bpNV = 0;
  }

  // A blob of cube k's jelly (the gel gun's): a lumpy little ball of it,
  // centred at c, moving at v, its rest shape centred at R in k's rest
  // space (somewhere nothing else's is), its vertices tagged. Lumpy at
  // rest: it keeps its lumps. rebuild() after. Returns its first vertex.
  addBlob(k, c, v, radius, R, tag, rnd = Math.random) {
    const mesh = buildCubeMesh(3, radius * 2, 0);
    const base = this.nV, tBase = this.nT;
    // (squashed one way and another; lumpy - a few slow waves over it, so
    // neighbouring points move together: per-point noise flattened its
    // tets into slivers, and they blew up)
    const sx = 1 + (rnd() - 0.5) * 0.5, sy = 1 + (rnd() - 0.5) * 0.5, sz = 1 + (rnd() - 0.5) * 0.5;
    const waves = [];
    for (let w = 0; w < 3; w++) {
      const z = 2 * rnd() - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - z * z);
      waves.push([s * Math.cos(a), s * Math.sin(a), z, 2 + rnd() * 2, rnd() * Math.PI * 2]);
    }
    // (turned any which way in the world)
    const qa = rnd() * Math.PI * 2, qb = Math.acos(2 * rnd() - 1), qc = rnd() * Math.PI * 2;
    const ca = Math.cos(qa), sa = Math.sin(qa), cb = Math.cos(qb), sb = Math.sin(qb), cc = Math.cos(qc), sc = Math.sin(qc);
    this.ensureV(base + mesh.nV);
    for (let i = 0; i < mesh.nV; i++) {
      // (rounded most of the way from a cube to a ball - all the way, its
      // corner cells go thin - then the lumps)
      let X = mesh.pos[i * 3], Y = mesh.pos[i * 3 + 1], Z = mesh.pos[i * 3 + 2];
      const l = Math.hypot(X, Y, Z), li = Math.max(Math.abs(X), Math.abs(Y), Math.abs(Z));
      if (l > 1e-9) {
        let w = 0;
        for (const [dx, dy, dz, fr, ph] of waves) w += Math.sin(((X * dx + Y * dy + Z * dz) / l) * fr + ph);
        const f = (1 + 0.6 * (li / l - 1)) * (1 + 0.066 * w * Math.min(1, li / radius));
        X *= f; Y *= f; Z *= f;
      }
      X *= sx; Y *= sy; Z *= sz;
      // (z-x-z turn)
      const x1 = ca * X - sa * Y, y1 = sa * X + ca * Y;
      const y2 = cb * y1 - sb * Z, z2 = sb * y1 + cb * Z;
      const wx = cc * x1 - sc * y2, wy = sc * x1 + cc * y2;
      this.addVertex(c[0] + wx, c[1] + wy, c[2] + z2, R[0] + X, R[1] + Y, R[2] + Z, v[0], v[1], v[2], 0, k, tag);
    }
    this.nT = tBase + mesh.nT;
    this.ensureT(this.nT);
    for (let t = 0; t < mesh.nT * 4; t++) this.T[tBase * 4 + t] = mesh.tets[t] + base;
    this.tVS.fill(1, tBase, this.nT);
    // (a little firmer than the jelly it's from: it splats, it doesn't crumple)
    this.tMu.fill(2.2, tBase, this.nT);
    this._bpNV = 0;
    return base;
  }

  // Take cube k out altogether (its vertices and tets; the rest closes up,
  // keeping where it is and how it moves). rebuild() after.
  removeCube(k) {
    this._removeVerts((i) => this.vCube[i] === k);
    this.cHollow[k] = 0;
    this.cav[k] = null;
    this.cHid[k] = 0;
    this.cPress[k] = 0;
  }

  // Take whole pieces out (their ids: a Set) - the gel gun's blobs.
  // rebuild() after.
  removePieces(ids) {
    this._removeVerts((i) => ids.has(this.vPiece[i]));
  }

  // (the vertices drop(i) says, and the tets on them - every tet's corners
  // must all go or all stay: a cube's, or a piece's. Anchors given - { tet,
  // b } held outside the body - are renumbered too: -1, gone with theirs.)
  _removeVerts(drop, anchors = null) {
    this.cubeVersion++;
    this.slitOf.fill(0); // (renumbered: what's across a slit, forgotten)
    const nV = this.nV, nT = this.nT, map = new Int32Array(nV).fill(-1);
    let n = 0;
    const vArr3 = [this.x, this.px, this.v, this.X];
    const vArr1 = [this.w, this.m, this.temp, this.glow, this.alive, this.melt, this.dust, this.fpen, this.wpen, this.vCube, this.vTag, this.vPiece];
    for (let i = 0; i < nV; i++) {
      if (drop(i)) continue;
      if (n !== i) {
        for (const a of vArr3) { a[n * 3] = a[i * 3]; a[n * 3 + 1] = a[i * 3 + 1]; a[n * 3 + 2] = a[i * 3 + 2]; }
        for (const a of vArr1) a[n] = a[i];
        this.coat.copyWithin(n * 5, i * 5, i * 5 + 5);
      }
      map[i] = n++;
    }
    let m = 0;
    const tmap = new Int32Array(nT).fill(-1);
    for (let t = 0; t < nT; t++) {
      const a = map[this.T[t * 4]];
      if (a < 0) continue;
      tmap[t] = m;
      this.T[m * 4] = a;
      this.T[m * 4 + 1] = map[this.T[t * 4 + 1]];
      this.T[m * 4 + 2] = map[this.T[t * 4 + 2]];
      this.T[m * 4 + 3] = map[this.T[t * 4 + 3]];
      this.tVS[m] = this.tVS[t];
      this.tMu[m] = this.tMu[t];
      m++;
    }
    this.nV = n;
    this.nT = m;
    // (the nails in the others stay in: their tets renumbered)
    for (let e = this.embeds.length - 1; e >= 0; e--) {
      const E = this.embeds[e], ta = E.a.tet >= 0 && E.a.tet < nT ? tmap[E.a.tet] : -1, tb = E.b.tet >= 0 && E.b.tet < nT ? tmap[E.b.tet] : -1;
      if (ta < 0 || tb < 0) this.embeds.splice(e, 1);
      else {
        E.a.tet = ta;
        E.b.tet = tb;
      }
    }
    if (anchors) for (const A of anchors) if (A && A.tet >= 0) A.tet = A.tet < nT ? tmap[A.tet] : -1;
    this.grabs.length = 0;
    this._bpNV = 0;
  }

  // Cube k - one whole piece - built again at resolution res just as it is:
  // its shape now and how it moves, how warm, its coat, how swollen - each
  // new point where the old jelly at that rest point is. (The dicer remeshes
  // a cube a whole number of cells to a die, then splits it along the grid -
  // see splitCube: no cut tets, no slivers.) Its nails, and the anchors
  // given (moved in place), go on the new tets at the same rest points.
  // Rebuilt.
  remeshCube(k, res, anchors = []) {
    const R = k * REST_STEP, mesh = buildCubeMesh(res, this.cSize[k], this.cBevel[k], this.shapeOf(k));
    const look = { tet: -1, b0: 0, b1: 0, b2: 0, b3: 0 };
    const where = (px, py, pz) => (this.locateRestFast(px, py, pz, look) && this.tCube[look.tet] === k ? [look.tet, look.b0, look.b1, look.b2, look.b3] : this._restNearest(k, px, py, pz));
    // (each anchor in it - a nail's, a weld's - by where it is at rest)
    const moved = [];
    const pin = (A) => {
      if (A && A.tet >= 0 && A.tet < this.nT && this.tCube[A.tet] === k) moved.push([A, this._restPoint(A.tet, A.b)]);
    };
    for (const E of this.embeds) {
      pin(E.a);
      pin(E.b);
    }
    for (const A of anchors) pin(A);
    const base = this.nV, tBase = this.nT, nv = mesh.nV, nt = mesh.nT;
    this.ensureV(base + nv);
    for (let i = 0; i < nv; i++) {
      const Xr = mesh.pos[i * 3] + R, Yr = mesh.pos[i * 3 + 1], Zr = mesh.pos[i * 3 + 2];
      const w = where(Xr, Yr, Zr);
      let wx = 0, wy = 0, wz = 0, vx = 0, vy = 0, vz = 0, te = 0, gl = 0, du = 0;
      const co = [0, 0, 0, 0, 0];
      if (w) {
        for (let q = 0; q < 4; q++) {
          const c = this.T[w[0] * 4 + q], bq = w[q + 1], o = c * 3;
          wx += this.x[o] * bq; wy += this.x[o + 1] * bq; wz += this.x[o + 2] * bq;
          vx += this.v[o] * bq; vy += this.v[o + 1] * bq; vz += this.v[o + 2] * bq;
          te += this.temp[c] * bq;
          gl += this.glow[c] * bq;
          du += this.dust[c] * bq;
          for (let e = 0; e < 5; e++) co[e] += this.coat[c * 5 + e] * bq;
        }
      }
      const j = this.addVertex(wx, wy, wz, Xr, Yr, Zr, vx, vy, vz, te, k, 0);
      this.glow[j] = gl;
      this.dust[j] = du;
      for (let e = 0; e < 5; e++) this.coat[j * 5 + e] = co[e];
    }
    this.nT = tBase + nt;
    this.ensureT(this.nT);
    for (let t = 0; t < nt; t++) {
      let cx = 0, cy = 0, cz = 0;
      for (let q = 0; q < 4; q++) {
        const c = mesh.tets[t * 4 + q];
        this.T[(tBase + t) * 4 + q] = c + base;
        cx += mesh.pos[c * 3] / 4; cy += mesh.pos[c * 3 + 1] / 4; cz += mesh.pos[c * 3 + 2] / 4;
      }
      const w = where(cx + R, cy, cz);
      this.tVS[tBase + t] = w ? this.tVS[w[0]] : 1;
      this.tMu[tBase + t] = w ? this.tMu[w[0]] : 1;
    }
    // (the anchors held on a new tet while the old ones go; put right below)
    for (const [A] of moved) {
      A.tet = tBase;
      A.b = [1, 0, 0, 0];
    }
    this._removeVerts((i) => i < base && this.vCube[i] === k, anchors);
    this.cN[k] = nv;
    this.cRes[k] = res;
    this.cH[k] = mesh.h;
    this.rebuild();
    for (const [A, p] of moved) {
      const w = where(p[0], p[1], p[2]);
      if (!w) continue;
      A.tet = w[0];
      A.b = [w[1], w[2], w[3], w[4]];
    }
  }

  // Cube k's tets pulled apart along rest-space planes square to each of
  // axes (0 x, 1 y, 2 z), n slabs a side - where a grid of a whole number of
  // cells to a slab puts them (see remeshCube): no tet's cut; the points
  // tets on two sides of a plane share are doubled, one for each side. Each
  // slab nudged apart by gap along dirs (the cube's axes in the world).
  // Rebuilt.
  splitCube(k, axes, n, dirs = null, gap = 0.004) {
    const half = this.cSize[k] / 2, R = k * REST_STEP, nT = this.nT;
    const key = new Int32Array(nT).fill(-1);
    for (let t = 0; t < nT; t++) {
      if (this.tCube[t] !== k || !(this.vol0[t] > 0)) continue;
      const c = [0, 0, 0];
      for (let q = 0; q < 4; q++) {
        const o = this.T[t * 4 + q] * 3;
        c[0] += this.X[o] / 4; c[1] += this.X[o + 1] / 4; c[2] += this.X[o + 2] / 4;
      }
      c[0] -= R;
      let kk = 0;
      for (const a of axes) kk = kk * n + Math.min(n - 1, Math.max(0, Math.floor(((c[a] + half) / (2 * half)) * n)));
      key[t] = kk;
    }
    const nV0 = this.nV, owner = new Int32Array(nV0).fill(-1), copies = new Map(), copyKey = [];
    for (let t = 0; t < nT; t++) {
      if (key[t] < 0) continue;
      for (let q = 0; q < 4; q++) {
        const i = this.T[t * 4 + q];
        if (i >= nV0) continue;
        if (owner[i] < 0) {
          owner[i] = key[t];
          continue;
        }
        if (owner[i] === key[t]) continue;
        const ck = i * 1024 + key[t];
        let j = copies.get(ck);
        if (j === undefined) {
          j = this._copyVertex(i);
          copies.set(ck, j);
          copyKey[j - nV0] = key[t];
        }
        this.T[t * 4 + q] = j;
      }
    }
    // (apart a little: each slab out from the middle along its axes)
    if (dirs && gap > 0) {
      const off = (kk, i) => {
        for (let ai = axes.length - 1; ai >= 0; ai--) {
          const s = kk % n, d = dirs[axes[ai]], f = (s - (n - 1) / 2) * gap;
          this.x[i * 3] += d[0] * f; this.x[i * 3 + 1] += d[1] * f; this.x[i * 3 + 2] += d[2] * f;
          kk = Math.floor(kk / n);
        }
      };
      for (let i = 0; i < nV0; i++) if (owner[i] >= 0) off(owner[i], i);
      for (let j = nV0; j < this.nV; j++) if (copyKey[j - nV0] !== undefined) off(copyKey[j - nV0], j);
    }
    this.rebuild();
  }

  // (a point the same as point i, for the far side of a split)
  _copyVertex(i) {
    const o = i * 3;
    const j = this.addVertex(this.x[o], this.x[o + 1], this.x[o + 2], this.X[o], this.X[o + 1], this.X[o + 2], this.v[o], this.v[o + 1], this.v[o + 2], this.temp[i], this.vCube[i], this.vTag[i]);
    this.px[j * 3] = this.px[o]; this.px[j * 3 + 1] = this.px[o + 1]; this.px[j * 3 + 2] = this.px[o + 2];
    this.glow[j] = this.glow[i];
    this.melt[j] = this.melt[i];
    this.dust[j] = this.dust[i];
    this.alive[j] = this.alive[i];
    this.coat.copyWithin(j * 5, i * 5, i * 5 + 5);
    return j;
  }

  // (rest point of weights b in tet t)
  _restPoint(t, b) {
    const p = [0, 0, 0];
    for (let q = 0; q < 4; q++) {
      const o = this.T[t * 4 + q] * 3;
      p[0] += this.X[o] * b[q]; p[1] += this.X[o + 1] * b[q]; p[2] += this.X[o + 2] * b[q];
    }
    return p;
  }

  // The tet of cube k nearest holding rest point p - the most nearly round
  // it, from the rest grid's cells about it - and its weights, held to the
  // tet: [t, b0, b1, b2, b3]. (A remesh's points near the rounded edges
  // can fall a hair outside the old mesh's.)
  _restNearest(k, px, py, pz) {
    const g = this._restGrid(), R = this.X, T = this.T, B = this.B;
    let best = -1, bs = -Infinity;
    const bb = [0, 0, 0, 0];
    for (let reach = 1; reach <= 3 && best < 0; reach++) {
      const ix = Math.floor(px * g.inv), iy = Math.floor(py * g.inv), iz = Math.floor(pz * g.inv);
      for (let a = -reach; a <= reach; a++)
        for (let b = -reach; b <= reach; b++)
          for (let c = -reach; c <= reach; c++) {
            const list = g.map.get((ix + a + 512) * 1048576 + (iy + b + 512) * 1024 + (iz + c + 512));
            if (!list) continue;
            for (const t of list) {
              if (this.tCube[t] !== k) continue;
              const o = T[t * 4] * 3, bo = t * 9;
              const rx = px - R[o], ry = py - R[o + 1], rz = pz - R[o + 2];
              const l1 = B[bo] * rx + B[bo + 1] * ry + B[bo + 2] * rz;
              const l2 = B[bo + 3] * rx + B[bo + 4] * ry + B[bo + 5] * rz;
              const l3 = B[bo + 6] * rx + B[bo + 7] * ry + B[bo + 8] * rz;
              const l0 = 1 - l1 - l2 - l3, sc = Math.min(l0, l1, l2, l3);
              if (sc > bs) {
                bs = sc;
                best = t;
                bb[0] = l0; bb[1] = l1; bb[2] = l2; bb[3] = l3;
              }
            }
          }
    }
    if (best < 0) return null;
    let s = 0;
    for (let q = 0; q < 4; q++) s += (bb[q] = Math.max(0, bb[q]));
    return [best, bb[0] / s, bb[1] / s, bb[2] / s, bb[3] / s];
  }

  // Each tet's share of its cube's firmness (see _solveTets): all of it - but in a cube full of liquid, its skin
  // (the tets its moulded surface's faces are on - and, a thicker skin, those touching that surface) as firm
  // as the skin's thickness (an ultrathin one a floppy bag: a hair's-breadth skin can't be a tet thick, but it
  // can be as weak as one), and its inside a liquid: next to none for water, to a quarter (near solid). Its
  // volume's kept all through: the inside flows, but doesn't squash. (A cut's faces aren't skin: they're the
  // liquid, open.)
  _liquidTets() {
    this._liqTopo = this.topoVersion;
    this._liqDirty = false;
    const nT = this.nT, L = this.tLq, tc = this.tCube, liq = this.cLiq;
    if (!L) return;
    let any = false;
    for (let k = 0; k < MAX_CUBES; k++) if (liq[k]) any = true;
    const Pr = this.tPr;
    if (!any || !this.sTri) {
      L.fill(1, 0, nT);
      Pr.fill(0, 0, nT);
      return;
    }
    const skin = this._skinT && this._skinT.length >= nT ? this._skinT : (this._skinT = new Uint8Array(this.tCap));
    const onSkin = this._skinV && this._skinV.length >= this.nV ? this._skinV : (this._skinV = new Uint8Array(this.vCap));
    skin.fill(0, 0, nT);
    onSkin.fill(0, 0, this.nV);
    const sT = this.sTri, sTet = this.sTet, sTag = this.sTag, T = this.T;
    for (let f = 0; f < this.nF; f++) {
      if (sTag[f] !== TAG_EXTERIOR) continue;
      skin[sTet[f]] = 1;
      onSkin[sT[f * 3]] = onSkin[sT[f * 3 + 1]] = onSkin[sT[f * 3 + 2]] = 1;
    }
    for (let t = 0; t < nT; t++) {
      const k = tc[t];
      if (!liq[k]) {
        L[t] = 1;
        Pr[t] = 0;
        continue;
      }
      const th = this.cSkin[k];
      // (hollow - its liquid real, the Fluid's: all that's left is its shell, as firm as the jelly it is - its
      // skin's how thick it is, thin ones floppy for that: see Spill)
      if (this.cHollow[k]) {
        L[t] = 1;
        Pr[t] = 0;
        continue;
      }
      let s = skin[t];
      if (!s && th > 0.33) {
        const q = t * 4;
        s = onSkin[T[q]] | onSkin[T[q + 1]] | onSkin[T[q + 2]] | onSkin[T[q + 3]];
      }
      // (its skin: a tenth as firm as the jelly, ultrathin - as firm, medium - two and a half times, thick)
      L[t] = s ? (th <= 0.5 ? 0.1 * Math.pow(10, 2 * th) : Math.pow(2.5, 2 * th - 1)) : 0.004 * Math.pow(0.25 / 0.004, this.cVisc[k]);
      // (the inside a little more than fits: the skin stretched taut round it, a filled balloon's - left as it
      // was, the liquid sank out from under its top and it dished in like a bowl)
      Pr[t] = s ? 0 : 0.06;
    }
    // (opened - liquid lying bare anywhere in a piece - none of its liquid's pushing out any more: it bulged
    // up out of the cut, and what was left in a cup stood in a hump)
    const open = this._liqOpen && this._liqOpen.length >= this.pieces.length ? this._liqOpen : (this._liqOpen = new Uint8Array(Math.max(64, this.pieces.length * 2)));
    open.fill(0, 0, this.pieces.length);
    let anyOpen = false;
    for (let f = 0; f < this.nF; f++) {
      const t = sTet[f];
      if (sTag[f] === TAG_EXTERIOR || !liq[tc[t]] || Pr[t] === 0) continue;
      open[this.tPiece[t]] = 1;
      anyOpen = true;
    }
    // (and its skin's inside - the layer kept as the wall when its liquid runs out, see Spill - as firm as the
    // skin: left as soft as the liquid it held, it sagged and swallowed what ran against it)
    if (anyOpen)
      for (let t = 0; t < nT; t++) {
        if (!open[this.tPiece[t]]) continue;
        Pr[t] = 0;
        const k = tc[t], th = this.cSkin[k], q = t * 4;
        if (!skin[t] && th <= 0.33 && onSkin[T[q]] | onSkin[T[q + 1]] | onSkin[T[q + 2]] | onSkin[T[q + 3]]) L[t] = 0.1 * Math.pow(10, 2 * th);
      }
  }

  // Cube k becomes cube j (a free slot): its rest shape moves over with it,
  // and its stuff. rebuild() after.
  moveCube(k, j) {
    this.cubeVersion++;
    const d = (j - k) * REST_STEP;
    for (let i = 0; i < this.nV; i++) {
      if (this.vCube[i] !== k) continue;
      this.vCube[i] = j;
      this.X[i * 3] += d;
    }
    for (const a of [this.cMu, this.cLam, this.cDens, this.cDamp, this.cFric, this.cBounce, this.cTack, this.cRigid, this.cAir, this.cBevel, this.cN, this.cGrav, this.cBoost, this.cSize, this.cRes, this.cH, this.cBow, this.cLobeA, this.cLobeP, this.cTrimK, this.cLiq, this.cVisc, this.cTens, this.cSkin, this.cFill, this.cHollow, this.cav, this.cHid, this.cPress, this.cWind]) a[j] = a[k];
    this.cHollow[k] = 0;
    this.cav[k] = null;
    this.cHid[k] = 0;
    this.cPress[k] = 0;
    this.cHole.copyWithin(j * 6, k * 6, k * 6 + 6);
    this.cHole[j * 6] += d;
    this.cHole[j * 6 + 3] += d;
    this._liqDirty = true;
    this.embeds.length = 0;
    this.grabs.length = 0;
    this._bpNV = 0;
  }

  // Cube k's material: mu, lambdaRatio, damping, friction, bounce, rigidity,
  // density, airDrag (any of them). (quiet: just the tables)
  setCube(k, q, quiet = false) {
    if (q.mu !== undefined) this.cMu[k] = q.mu;
    if (q.lambdaRatio !== undefined) this.cLam[k] = q.lambdaRatio;
    if (q.damping !== undefined) this.cDamp[k] = q.damping;
    if (q.friction !== undefined) this.cFric[k] = q.friction;
    if (q.bounce !== undefined) this.cBounce[k] = q.bounce;
    if (q.tack !== undefined) this.cTack[k] = q.tack;
    if (q.rigidity !== undefined) this.cRigid[k] = q.rigidity;
    if (q.airDrag !== undefined) this.cAir[k] = q.airDrag;
    // (full of liquid: its tets' shares of its firmness made again before the next step - see _liquidTets)
    if (q.liquid !== undefined && (q.liquid ? 1 : 0) !== this.cLiq[k]) (this.cLiq[k] = q.liquid ? 1 : 0), (this._liqDirty = true);
    if (q.liqVisc !== undefined && q.liqVisc !== this.cVisc[k]) (this.cVisc[k] = q.liqVisc), (this._liqDirty = true);
    if (q.liqTension !== undefined) this.cTens[k] = q.liqTension;
    if (q.liqSkin !== undefined && q.liqSkin !== this.cSkin[k]) (this.cSkin[k] = q.liqSkin), (this._liqDirty = true);
    if (q.liqFill !== undefined) this.cFill[k] = q.liqFill;
    if (q.density !== undefined && q.density !== this.cDens[k]) {
      this.cDens[k] = q.density;
      if (!quiet && this.nT) {
        this._computeMass();
        for (const pc of this.pieces) {
          let mm = 0;
          for (const i of pc.verts) mm += this.m[i];
          pc.mass = mm;
        }
      }
    }
    this._anyRigid = false;
    for (let j = 0; j < MAX_CUBES; j++) if (this.cRigid[j] > 0) this._anyRigid = true;
  }

  // Recompute everything derived from topology.
  // Change material density live (re-lumps vertex masses).
  setDensity(d) {
    if (d === this.p.density) return;
    this.p.density = d;
    this.cDens[0] = d;
    this._computeMass();
    for (const pc of this.pieces) {
      let m = 0;
      for (const i of pc.verts) m += this.m[i];
      pc.mass = m;
    }
    this.wakeAll();
  }

  wakeAll() {
    for (const pc of this.pieces) {
      pc.sleepT = 0;
      pc.asleep = false;
    }
    this._hashDirty = true;
  }

  // Pieces nailed to each other (embeds marked pair - the gel gun's blobs)
  // sleep and wake together: one stirring wakes the others. (Nails within
  // a piece keep the whole body awake, as before.)
  _wakeNailed() {
    const tp = this.tPiece, P = this.pieces, nT = this.nT, T = this.T, v = this.v;
    for (let pass = 0; pass < 6; pass++) {
      let any = false;
      for (const e of this.embeds) {
        if (e.a.tet < 0 || e.b.tet < 0 || e.a.tet >= nT || e.b.tet >= nT) continue;
        const A = P[tp[e.a.tet]], B = P[tp[e.b.tet]];
        if (!A || !B || A === B || A.asleep === B.asleep) continue;
        // (only if the nail's other end is really moving: one just not yet
        // asleep, nudging a sleeper awake again and again, kept both up)
        const sleeper = A.asleep ? A : B, t = A.asleep ? e.b.tet : e.a.tet;
        let s2 = 0;
        for (let k = 0; k < 4; k++) {
          const o = T[t * 4 + k] * 3;
          s2 = Math.max(s2, v[o] * v[o] + v[o + 1] * v[o + 1] + v[o + 2] * v[o + 2]);
        }
        if (s2 > 0.2 * 0.2) {
          this.wake(sleeper.id);
          any = true;
        }
      }
      if (!any) break;
    }
  }

  // Piece pc to sleep, still where it is.
  sleepPiece(pc) {
    const v = this.v, vs = pc.verts;
    if (!pc.asleep) this._hashDirty = true;
    pc.asleep = true;
    pc.vib = 0;
    pc.nwT = pc.nwV = pc.nwU = pc.nwN = 0;
    pc.nwS.fill(NaN);
    pc.foldAsk = true; // (not to be left asleep folded into itself)
    for (let k = 0; k < vs.length; k++) {
      const o = vs[k] * 3;
      v[o] = v[o + 1] = v[o + 2] = 0;
    }
  }

  wake(k) {
    const pc = this.pieces[k];
    if (pc) {
      if (pc.asleep) this._hashDirty = true;
      pc.sleepT = 0;
      pc.asleep = false;
    }
  }

  // Some vertices' rest shape eased over dur (s) from where it is now to
  // tgt (3 a vertex) - the torn ends' drawn-out shape giving back after a
  // tear (see HandTool._yield): at once it sprang the halves apart; never,
  // they kept it for good, thin shards of it. A change in topology ends it.
  easeRest(idx, tgt, dur) {
    const X = this.X, from = new Float64Array(idx.length * 3);
    for (let j = 0; j < idx.length; j++) for (let c = 0; c < 3; c++) from[j * 3 + c] = X[idx[j] * 3 + c];
    this._restEase = { idx, from, tgt, t: 0, dur, ver: this.topoVersion };
  }
  _tickRestEase(dt) {
    const E = this._restEase, X = this.X;
    if (E.ver !== this.topoVersion) {
      this._restEase = null;
      return;
    }
    E.t += dt;
    const u = Math.min(1, E.t / E.dur), k = u * u * (3 - 2 * u);
    for (let j = 0; j < E.idx.length; j++) {
      const o = E.idx[j] * 3;
      for (let c = 0; c < 3; c++) X[o + c] = E.from[j * 3 + c] + (E.tgt[j * 3 + c] - E.from[j * 3 + c]) * k;
    }
    this._computeRest();
    if (u >= 1) {
      this._computeMass();
      this.refreshSurface();
      this._restEase = null;
      this.restVersion++;
    }
  }

  // The surface worked out again from the rest shape as it is now, its
  // topology the same: its faces' rest normals and tags, the render's
  // smoothing groups - after the rest shape's changed in place (a rounding
  // eased to another, torn ends giving back). Else the old shape's creases
  // stay: a sharp crease left on a round edge, a sharp edge smoothed over.
  refreshSurface() {
    this._extractSurface();
    this._computeEscape();
    this._buildRenderClusters();
    this._findHinges();
    this._rg = null;
  }

  // Just what the next cut needs (rest shapes, masses, adjacency, pieces):
  // for a run of cuts in one go, ending with a full rebuild() before the
  // body is stepped or drawn again.
  rebuildLight() {
    this.topoStale = true;
    this.tDmg.fill(0, 0, this.nT);
    this._computeRest();
    this._computeMass();
    this._buildAdjacency();
    this._lightBuild = true;
    this._buildPieces();
    this._lightBuild = false;
  }

  rebuild() {
    const t0 = performance.now();
    this.topoStale = false;
    this.tDmg.fill(0, 0, this.nT);
    this.dmgHeal = 0;
    this._computeRest();
    this._computeMass();
    this._buildAdjacency();
    this._buildPieces();
    this._extractSurface();
    this._computeEscape();
    this._buildRenderClusters();
    this._findHinges();
    this._sizeContactScratch();
    // (all that a light build changed has its surface, escape and hinges now)
    if (this._vDirty) this._vDirty.fill(0);
    this.topoVersion++;
    this.rebuildMs += performance.now() - t0; // (read and cleared by ?stats)
    this.rebuilds++;
  }

  // A piece still joined to itself across a cut - a flap on a hinge - has
  // the two sides of that cut facing each other, a blade's width apart: it
  // needs self-contact, or the flap drops straight through the rest.
  _findHinges() {
    const { sTri, sTag, sTet, X, tPiece, sRestN } = this;
    // (a piece the change didn't touch keeps what it had: see _buildPieces)
    const carried = this._carried && this._carried.length === this.pieces.length ? this._carried : null;
    for (const pc of this.pieces) if (!carried || !carried[pc.id]) pc.hinge = pc.gap = false;
    const C = 0.02 * this.p.size, iC = 1 / C, near2 = (0.6 * C) ** 2;
    const cells = new Map();
    const cen = new Float64Array(this.nF * 3);
    const key = (i, j, k) => (i + 512) * 1048576 + (j + 512) * 1024 + (k + 512);
    for (let f = 0; f < this.nF; f++) {
      if (sTag[f] === TAG_EXTERIOR || (carried && carried[tPiece[sTet[f]]])) continue;
      const a = sTri[f * 3] * 3, b = sTri[f * 3 + 1] * 3, c = sTri[f * 3 + 2] * 3;
      for (let e = 0; e < 3; e++) cen[f * 3 + e] = (X[a + e] + X[b + e] + X[c + e]) / 3;
      const k = key(Math.floor(cen[f * 3] * iC), Math.floor(cen[f * 3 + 1] * iC), Math.floor(cen[f * 3 + 2] * iC));
      const l = cells.get(k);
      if (l) l.push(f);
      else cells.set(k, [f]);
    }
    for (const [k, list] of cells) {
      const ci = Math.floor(k / 1048576) - 512, cj = (Math.floor(k / 1024) % 1024) - 512, ck = (k % 1024) - 512;
      for (const f of list) {
        const pf = tPiece[sTet[f]];
        if (this.pieces[pf].hinge) continue;
        for (let di = -1; di <= 1 && !this.pieces[pf].hinge; di++)
          for (let dj = -1; dj <= 1 && !this.pieces[pf].hinge; dj++)
            for (let dk = -1; dk <= 1; dk++) {
              const other = cells.get(key(ci + di, cj + dj, ck + dk));
              if (!other) continue;
              for (const g of other) {
                if (g === f || tPiece[sTet[g]] !== pf) continue;
                const dn = sRestN[f * 3] * sRestN[g * 3] + sRestN[f * 3 + 1] * sRestN[g * 3 + 1] + sRestN[f * 3 + 2] * sRestN[g * 3 + 2];
                if (dn > -0.8) continue;
                const dx = cen[f * 3] - cen[g * 3], dy = cen[f * 3 + 1] - cen[g * 3 + 1], dz = cen[f * 3 + 2] - cen[g * 3 + 2];
                if (dx * dx + dy * dy + dz * dz < near2) {
                  this.pieces[pf].hinge = true;
                  break;
                }
              }
              if (this.pieces[pf].hinge) break;
            }
      }
    }
    // ...and one with a cut's two sides facing each other across a gap that
    // can close: a row of bullet holes through it, its top half held on by
    // the webs between them - the gap closes under the weight, and with no
    // self-contact the top half sank straight into the bottom one and stuck
    // there. (A scoop's walls, a crater's, too. Not a die's cut faces: back
    // to back, they face away from each other. Every other cut face asks; a
    // gap has plenty of pairs.)
    const D = 0.16 * this.p.size, iD = 1 / D, D2 = D * D, gc = new Map();
    for (let f = 0; f < this.nF; f++) {
      if (sTag[f] === TAG_EXTERIOR || (carried && carried[tPiece[sTet[f]]]) || this.pieces[tPiece[sTet[f]]].hinge) continue;
      const k = key(Math.floor(cen[f * 3] * iD), Math.floor(cen[f * 3 + 1] * iD), Math.floor(cen[f * 3 + 2] * iD));
      const l = gc.get(k);
      if (l) l.push(f);
      else gc.set(k, [f]);
    }
    let budget = 4e6;
    for (const [k, list] of gc) {
      if (budget <= 0) break;
      const ci = Math.floor(k / 1048576) - 512, cj = (Math.floor(k / 1024) % 1024) - 512, ck = (k % 1024) - 512;
      for (let q = 0; q < list.length && budget > 0; q += 2) {
        const f = list[q], pc = this.pieces[tPiece[sTet[f]]];
        if (pc.gap) continue;
        const pf = pc.id, nx = sRestN[f * 3], ny = sRestN[f * 3 + 1], nz = sRestN[f * 3 + 2];
        search: for (let di = -1; di <= 1; di++)
          for (let dj = -1; dj <= 1; dj++)
            for (let dk = -1; dk <= 1; dk++) {
              const other = gc.get(key(ci + di, cj + dj, ck + dk));
              if (!other) continue;
              budget -= other.length;
              for (const g of other) {
                if (tPiece[sTet[g]] !== pf || nx * sRestN[g * 3] + ny * sRestN[g * 3 + 1] + nz * sRestN[g * 3 + 2] > -0.6) continue;
                const dx = cen[g * 3] - cen[f * 3], dy = cen[g * 3 + 1] - cen[f * 3 + 1], dz = cen[g * 3 + 2] - cen[f * 3 + 2], d2 = dx * dx + dy * dy + dz * dz;
                // (across the gap from it: in front of it, as it faces)
                if (d2 > D2 || dx * nx + dy * ny + dz * nz < 0.5 * Math.sqrt(d2)) continue;
                pc.gap = true;
                break search;
              }
            }
      }
    }
  }

  // The contact pass's scratch arrays, sized for the new topology here
  // (rebuilds are rare) so the per-frame code never takes a growth branch
  // for the first time - that throws its optimised code away mid-frame.
  _sizeContactScratch() {
    const NP = Math.max(this.pieces.length, 64), V = this.vCap, Tc = this.tCap;
    const F = Math.max(this.nF * 2, 1024), Pr = (V + Math.max(this.nF, 1024)) * 2;
    const f64 = (a, n) => (a && a.length >= n ? a : new Float64Array(n));
    const f32 = (a, n) => (a && a.length >= n ? a : new Float32Array(n));
    const i32 = (a, n) => (a && a.length >= n ? a : new Int32Array(n));
    const u8 = (a, n) => (a && a.length >= n ? a : new Uint8Array(n));
    this._pbb = f64(this._pbb, NP * 6);
    this._pcs = f64(this._pcs, NP);
    this._pVel = f64(this._pVel, NP * 3);
    this._pMass = f64(this._pMass, NP);
    this._pieceActive = u8(this._pieceActive, NP);
    this._ptS = i32(this._ptS, NP + 1);
    this._sweep = f32(this._sweep, V * 6);
    this._disp = f32(this._disp, V * 3);
    this._hCount = this._hCount || new Int32Array((1 << 15) + 1);
    this._hFill = this._hFill || new Int32Array(1 << 15);
    this._tBox0 = f32(this._tBox0, Tc * 6);
    this._hRanges = i32(this._hRanges, Tc * 6);
    this._hTets = i32(this._hTets, Tc);
    this._tStat = f32(this._tStat, Tc * 8);
    this._hEntries = i32(this._hEntries, Tc * 16);
    this._probeV = i32(this._probeV, V);
    this._probeF = i32(this._probeF, F);
    this._pcStart = i32(this._pcStart, Pr);
    this._pcEnd = i32(this._pcEnd, Pr);
    this._pRel = f32(this._pRel, Pr);
    this._probeSeen = u8(this._probeSeen, V);
    this._tStamp = i32(this._tStamp, Tc);
    this._cList = i32(this._cList, 1 << 17);
    this._vcS = i32(this._vcS, V);
    this._vcE = i32(this._vcE, V);
    this._vcR = f32(this._vcR, V);
    this._fcS = i32(this._fcS, F);
    this._fcE = i32(this._fcE, F);
    this._fcR = f32(this._fcR, F);
    this._skip = f32(this._skip, Pr);
    this._tBoxNow = f32(this._tBoxNow, Tc * 6);
    this._tBoxStamp = i32(this._tBoxStamp, Tc);
    this._selfOK = u8(this._selfOK, NP);
    this._hood = i32(this._hood, V);
    // tets touching the surface (a piece against itself only meets those:
    // whatever folds into it comes in through them - the ones right on a
    // cut can be slivers, so the whole layer)
    const ts = (this._tSurf = u8(this._tSurf, Tc));
    const onS = new Uint8Array(this.nV);
    for (let k = 0; k < this.nF * 3; k++) onS[this.sTri[k]] = 1;
    for (let t = 0; t < this.nT; t++) {
      const o = t * 4;
      ts[t] = onS[this.T[o]] | onS[this.T[o + 1]] | onS[this.T[o + 2]] | onS[this.T[o + 3]];
    }
    // the surface vertices, and scratch for finding the ones near another
    // part of their own body (see _buildCollisionHash)
    const sv = (this._surfV = i32(this._surfV, V));
    let n = 0;
    for (let i = 0; i < this.nV; i++) if (onS[i]) sv[n++] = i;
    this._nSurfV = n;
    this._selfFlag = u8(this._selfFlag, V);
    this._selfD = f32(this._selfD, V);
    this._svStart = i32(this._svStart, 4097);
    this._svFill = i32(this._svFill, 4096);
    // (slivers: tets under ~1% of a whole one - see _dampPieces - their corners)
    const SL = (this._sliverV = u8(this._sliverV, V)), vMin = 0.0015 * this.hCell ** 3;
    SL.fill(0, 0, this.nV);
    for (let t = 0; t < this.nT; t++) {
      const v0 = this.vol0[t];
      if (v0 > 0 && v0 < vMin) for (let j = 0; j < 4; j++) SL[this.T[t * 4 + j]] = 1;
    }
    // the look for folds: per-vertex hold times (vertex numbers changed:
    // start over), and its own grid of tets
    this._foldUntil = f64(this._foldUntil, V);
    this._foldUntil.fill(0);
    this._foldLook = u8(this._foldLook, NP);
    this._fgCount = this._fgCount || new Int32Array((1 << 14) + 1);
    this._fgEnt = i32(this._fgEnt, Tc * 8);
    this._fgBox = f32(this._fgBox, Tc * 6);
    this._svList = i32(this._svList, V);
  }

  // For every vertex: rest-space vector to the nearest boundary vertex of its
  // own piece (multi-source Dijkstra carrying the nearest source, i.e. a
  // graph approximation of the Euclidean distance transform). Lets contact
  // push a deeply-penetrated point out the right way.
  _computeEscape() {
    const nV = this.nV, X = this.X;
    // (pieces the change didn't touch keep theirs - their vertices, rest
    // shape and skin are as they were: see _buildPieces)
    const keep = this.esc && this.esc.length >= nV * 3 && this._carried && this._carried.length === this.pieces.length;
    const carried = keep ? this._carried : null, vp = this.vPiece;
    const near = new Int32Array(nV).fill(-1);
    const dist = new Float64Array(nV).fill(Infinity);
    let cap = Math.max(1024, nV * 6);
    let hI = new Int32Array(cap), hK = new Float64Array(cap), n = 0;
    const push = (i, k) => {
      if (n >= cap) {
        cap *= 2;
        const a = new Int32Array(cap); a.set(hI); hI = a;
        const b = new Float64Array(cap); b.set(hK); hK = b;
      }
      let c = n++;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (hK[p] <= k) break;
        hI[c] = hI[p]; hK[c] = hK[p]; c = p;
      }
      hI[c] = i; hK[c] = k;
    };
    const pop = () => {
      const top = hI[0];
      const li = hI[--n], lk = hK[n];
      let c = 0;
      for (;;) {
        let ch = c * 2 + 1;
        if (ch >= n) break;
        if (ch + 1 < n && hK[ch + 1] < hK[ch]) ch++;
        if (hK[ch] >= lk) break;
        hI[c] = hI[ch]; hK[c] = hK[ch]; c = ch;
      }
      hI[c] = li; hK[c] = lk;
      return top;
    };
    for (let k = 0; k < this.nF * 3; k++) {
      const i = this.sTri[k];
      if (dist[i] !== 0 && !(carried && carried[vp[i]])) {
        dist[i] = 0;
        near[i] = i;
        push(i, 0);
      }
    }
    const nbS = this.nbStart, nbL = this.nbList;
    while (n > 0) {
      const d0 = hK[0];
      const i = pop();
      if (d0 > dist[i]) continue;
      const c = near[i], cx = X[c * 3], cy = X[c * 3 + 1], cz = X[c * 3 + 2];
      for (let e = nbS[i]; e < nbS[i + 1]; e++) {
        const j = nbL[e];
        const d = Math.hypot(X[j * 3] - cx, X[j * 3 + 1] - cy, X[j * 3 + 2] - cz);
        if (d < dist[j]) {
          dist[j] = d;
          near[j] = c;
          push(j, d);
        }
      }
    }
    const esc = this.esc && this.esc.length >= nV * 3 ? this.esc : (this.esc = new Float32Array(this.vCap * 3));
    for (let i = 0; i < nV; i++) {
      if (carried && vp[i] >= 0 && carried[vp[i]]) continue;
      const c = near[i];
      if (c < 0) {
        esc[i * 3] = esc[i * 3 + 1] = esc[i * 3 + 2] = 0;
        continue;
      }
      esc[i * 3] = X[c * 3] - X[i * 3];
      esc[i * 3 + 1] = X[c * 3 + 1] - X[i * 3 + 1];
      esc[i * 3 + 2] = X[c * 3 + 2] - X[i * 3 + 2];
    }
  }

  _computeRest(from = 0) {
    const { T, X, B, vol0 } = this;
    for (let t = from; t < this.nT; t++) {
      const o = t * 4;
      const a = T[o] * 3, b = T[o + 1] * 3, c = T[o + 2] * 3, d = T[o + 3] * 3;
      const m00 = X[b] - X[a], m10 = X[b + 1] - X[a + 1], m20 = X[b + 2] - X[a + 2];
      const m01 = X[c] - X[a], m11 = X[c + 1] - X[a + 1], m21 = X[c + 2] - X[a + 2];
      const m02 = X[d] - X[a], m12 = X[d + 1] - X[a + 1], m22 = X[d + 2] - X[a + 2];
      const det = m00 * (m11 * m22 - m12 * m21) - m01 * (m10 * m22 - m12 * m20) + m02 * (m10 * m21 - m11 * m20);
      const bo = t * 9;
      if (det <= 1e-14) {
        vol0[t] = 0;
        for (let k = 0; k < 9; k++) B[bo + k] = 0;
        continue;
      }
      const id = 1 / det;
      vol0[t] = det / 6;
      B[bo] = (m11 * m22 - m12 * m21) * id;
      B[bo + 1] = (m02 * m21 - m01 * m22) * id;
      B[bo + 2] = (m01 * m12 - m02 * m11) * id;
      B[bo + 3] = (m12 * m20 - m10 * m22) * id;
      B[bo + 4] = (m00 * m22 - m02 * m20) * id;
      B[bo + 5] = (m02 * m10 - m00 * m12) * id;
      B[bo + 6] = (m10 * m21 - m11 * m20) * id;
      B[bo + 7] = (m01 * m20 - m00 * m21) * id;
      B[bo + 8] = (m00 * m11 - m01 * m10) * id;
    }
  }

  _computeMass() {
    const { m, w, T, vol0, tVS, tCube, vCube, cDens } = this;
    for (let t = 0; t < this.nT; t++) tCube[t] = vCube[T[t * 4]];
    m.fill(0, 0, this.nV);
    for (let t = 0; t < this.nT; t++) {
      const q = (cDens[tCube[t]] * vol0[t] * tVS[t]) / 4;
      const o = t * 4;
      m[T[o]] += q; m[T[o + 1]] += q; m[T[o + 2]] += q; m[T[o + 3]] += q;
    }
    // floor tiny lumped masses (corner vertices of single tets jitter otherwise)
    let tot = 0, cnt = 0;
    for (let i = 0; i < this.nV; i++) if (m[i] > 0) { tot += m[i]; cnt++; }
    const mMin = cnt ? (0.3 * tot) / cnt : 0;
    for (let i = 0; i < this.nV; i++) {
      if (m[i] > 0) {
        if (m[i] < mMin) m[i] = mMin;
        w[i] = 1 / m[i];
        this.alive[i] = 1;
      } else {
        w[i] = 0;
        this.alive[i] = 0;
      }
    }
    // How stiff each tet is for the corners it moves: V * sum(w_i |b_i|^2)
    // (b_i = how its corner i moves F; per unit density). Cuts leave small
    // tets on light corners up to 60x stiffer for their mass than any tet of
    // the whole cube; a piece made of them never comes to rest - its two
    // elastic terms overshoot each other every substep and it buzzes at
    // metres a second, skating over the floor like a bristlebot. Those tets
    // are softened to a set level (per unit cell size^-2): every tet of a
    // whole sharp or soft-edged cube is below it, a round one's most
    // squashed bevel tets touch it; frozen boosts scale on top as before.
    const { B, tKs } = this;
    for (let t = 0; t < this.nT; t++) {
      if (vol0[t] <= 0) {
        tKs[t] = 1;
        continue;
      }
      const o = t * 9, q = t * 4;
      const b1 = B[o] * B[o] + B[o + 1] * B[o + 1] + B[o + 2] * B[o + 2];
      const b2 = B[o + 3] * B[o + 3] + B[o + 4] * B[o + 4] + B[o + 5] * B[o + 5];
      const b3 = B[o + 6] * B[o + 6] + B[o + 7] * B[o + 7] + B[o + 8] * B[o + 8];
      const s0 = B[o] + B[o + 3] + B[o + 6], s1 = B[o + 1] + B[o + 4] + B[o + 7], s2 = B[o + 2] + B[o + 5] + B[o + 8];
      const k = vol0[t] * Math.cbrt(tVS[t]) * cDens[tCube[t]] * (w[T[q]] * (s0 * s0 + s1 * s1 + s2 * s2) + w[T[q + 1]] * b1 + w[T[q + 2]] * b2 + w[T[q + 3]] * b3);
      tKs[t] = k;
    }
    const kRef = 4.5 / (this.hCell * this.hCell);
    for (let t = 0; t < this.nT; t++) if (vol0[t] > 0) tKs[t] = tKs[t] > kRef ? kRef / tKs[t] : 1;
    // ...and each cube's typical tet's hard, at rest (the median over its
    // whole-sized tets - a cut's small ones left out): see DEV_SOFT_CUBE
    const HT = this.cHardTyp || (this.cHardTyp = new Float64Array(MAX_CUBES)), lists = Array.from({ length: MAX_CUBES }, () => []);
    for (let t = 0; t < this.nT; t++) {
      if (!(vol0[t] > 0)) continue;
      const k = tCube[t], h = this.cH[k] || this.hCell, v6 = (h * h * h) / 6;
      if (vol0[t] < 0.6 * v6 || vol0[t] > 2.4 * v6) continue;
      const o = t * 9, q = t * 4;
      const b1 = B[o] * B[o] + B[o + 1] * B[o + 1] + B[o + 2] * B[o + 2];
      const b2 = B[o + 3] * B[o + 3] + B[o + 4] * B[o + 4] + B[o + 5] * B[o + 5];
      const b3 = B[o + 6] * B[o + 6] + B[o + 7] * B[o + 7] + B[o + 8] * B[o + 8];
      const s0 = B[o] + B[o + 3] + B[o + 6], s1 = B[o + 1] + B[o + 4] + B[o + 7], s2 = B[o + 2] + B[o + 5] + B[o + 8];
      lists[k].push((w[T[q]] * (s0 * s0 + s1 * s1 + s2 * s2) + w[T[q + 1]] * b1 + w[T[q + 2]] * b2 + w[T[q + 3]] * b3) / 3);
    }
    for (let k = 0; k < MAX_CUBES; k++) {
      const L = lists[k];
      if (!L.length) continue; // (none whole: as it was)
      L.sort((a, b) => a - b);
      HT[k] = L[L.length >> 1];
    }
  }

  _buildAdjacency() {
    const nV = this.nV, nT = this.nT, T = this.T;
    const start = new Int32Array(nV + 1);
    for (let k = 0; k < nT * 4; k++) start[T[k] + 1]++;
    for (let i = 0; i < nV; i++) start[i + 1] += start[i];
    const fill = start.slice(0, nV);
    const list = new Int32Array(nT * 4);
    for (let t = 0; t < nT; t++) for (let k = 0; k < 4; k++) list[fill[T[t * 4 + k]]++] = t;
    this.vtStart = start;
    this.vtList = list;

    // vertex-vertex neighbours (for heat diffusion)
    const seen = new Int32Array(nV).fill(-1);
    const nbStart = new Int32Array(nV + 1);
    const tmp = [];
    for (let i = 0; i < nV; i++) {
      nbStart[i] = tmp.length;
      for (let k = start[i]; k < start[i + 1]; k++) {
        const t = list[k];
        for (let j = 0; j < 4; j++) {
          const u = T[t * 4 + j];
          if (u !== i && seen[u] !== i) {
            seen[u] = i;
            tmp.push(u);
          }
        }
      }
    }
    nbStart[nV] = tmp.length;
    this.nbStart = nbStart;
    this.nbList = Int32Array.from(tmp);
  }

  _buildPieces() {
    const nV = this.nV, nT = this.nT, T = this.T;
    // (each vertex's piece before this rebuild: see the end)
    const oldNV = Math.min(this._bpNV, nV), oldVP = this.vPiece.slice(0, oldNV);
    const parent = new Int32Array(nV);
    for (let i = 0; i < nV; i++) parent[i] = i;
    const find = (a) => {
      while (parent[a] !== a) {
        parent[a] = parent[parent[a]];
        a = parent[a];
      }
      return a;
    };
    for (let t = 0; t < nT; t++) {
      const r0 = find(T[t * 4]);
      for (let k = 1; k < 4; k++) {
        const r = find(T[t * 4 + k]);
        if (r !== r0) parent[r] = r0;
      }
    }
    const label = new Int32Array(nV).fill(-1);
    let K = 0;
    const pieceVerts = [];
    const pieceTets = [];
    for (let i = 0; i < nV; i++) {
      if (!this.alive[i]) {
        this.vPiece[i] = -1;
        continue;
      }
      const r = find(i);
      if (label[r] < 0) {
        label[r] = K++;
        pieceVerts.push([]);
        pieceTets.push([]);
      }
      this.vPiece[i] = label[r];
      pieceVerts[label[r]].push(i);
    }
    for (let t = 0; t < nT; t++) {
      const k = this.vPiece[T[t * 4]];
      this.tPiece[t] = k;
      // (a tet squeezed flat has no volume, so its corners can have no mass
      // and be dead - it belongs to no piece; it used to throw here)
      if (k < 0) continue;
      pieceTets[k].push(t);
    }
    const old = this.pieces || [];
    this.pieces = pieceVerts.map((vs, k) => {
      let mass = 0, vol = 0;
      for (const i of vs) mass += this.m[i];
      for (const t of pieceTets[k]) vol += this.vol0[t] * this.tVS[t];
      return asFloat({
        id: k,
        cube: this.vCube[vs[0]], // (which cube it's of: its material)
        verts: Int32Array.from(vs),
        tets: Int32Array.from(pieceTets[k]),
        mass,
        volume: vol,
        com: new Float64Array(3),
        vel: new Float64Array(3),
        bbox: new Float64Array(6),
        omega: new Float64Array(3),
        sleepT: 0,
        asleep: false,
        // (all fields up front - see the constructor)
        air: 0, // (s) left of its having been up off the floor just now - what makes a landing one (see _dampPieces)
        lastVy: 0, // (m/s) its middle's speed up, the step before
        landAt: -1e9, // (sim time) it last came down out of the air, hard - see _tangleCheck
        splatT: 0, // (s) left of its splat's hold - how hard (0..1), and how fast it came down (m/s)
        splatK: 0,
        splatV: 0,
        rebT: 0,
        impY: 0,
        boosted: false,
        rebR: 0,
        impR: 0,
        impUx: 0,
        impUz: 0,
        boostedR: false,
        impPrev: new Float64Array(3),
        impPend: null,
        impT: -1,
        impDv: 0,
        sleepLogMu: undefined,
        hinge: false, // still joined to itself across a cut (see _findHinges)
        gap: false, // a cut's two sides facing each other across a gap that can close (see _findHinges)
        foldN: 0, // (folds found in it, look after look, untouched; past FOLD_GIVE_UP left be till touched: see _foldCheck)
        foldTouch: -1,
        foldGiveUp: -1,
        foldUntil: 0, // (sim time) has vertices folded into itself till then (see _foldCheck)
        foldAsk: false, // look for folds next frame (it has just fallen asleep)
        buzzT: 0, // (s) still, but buzzing, for this long (see _dampPieces)
        buzzA: 0, // (its buzz over the first and the second half of that)
        buzzB: 0,
        nwT: 0, // (s) into this second of going nowhere (see _dampPieces), and its shiver over it - and the last's
        nwV: 0,
        nwU: 0,
        nwN: 0, // (seconds running it went nowhere)
        nwS: new Float64Array(36).fill(NaN), // (where 12 of its vertices were as the second began)
        hush: 0, // (s) left of being damped hard: shaking where it sat (see _dampPieces)
        hushN: 0, // (times hushed since it last went anywhere)
        tangleN: 0, // looks in a row that found it passed through itself (see _tangleCheck)
        touchT: -1e9, // (sim time) last held or blasted - what tangles a piece
        vib: 0, // (m/s) how fast it jiggles: its vertices' rms speed apart from moving as a whole (the jelly's voice follows it)
        untangle: 0, // (s) left of springing back out of that
        tangleTries: 0, // springings back since it was last touched (see _tangleCheck)
        tangleTouch: -1e9, // (that touch)
        fitQ: new Float64Array([0, 0, 0, 1]), // its last fitted rotation (rest -> now)
        rigQ: new Float64Array([0, 0, 0, 1]), // (the same, for _solveRigidity: warm from the last substep)
      }, PIECE_FLOATS);
    });
    // A piece the change didn't touch - the very same vertices as one piece
    // before it - carries on as it was: asleep if it was asleep. (Every
    // piece used to come out of a rebuild awake: one knife swipe through a
    // settled pile of a hundred pieces woke them all, to buzz and settle
    // again at full cost for seconds.)
    // But a sleeper touching anything that did change wakes (what it rested
    // on may have been cut away or removed): any of its vertices within 2 cm
    // of a vertex of a changed piece, as it was or as it is now.
    const kept = new Uint8Array(old.length), carried = (this._carried = new Uint8Array(this.pieces.length));
    // (a light build - another change follows at once, see rebuildLight -
    // works out no surface, escape or hinges for what it changed: that's
    // marked, and not carried over unworked by the full one after it - a
    // gun's plug, taken out after its light cut, left the cube it was shot
    // through 'unchanged' since the cut, its hinges never looked for, and
    // its top half sank into its bottom one)
    if (this._vDirty && this._vDirty.length < this.vCap) {
      const D = new Uint8Array(this.vCap);
      D.set(this._vDirty);
      this._vDirty = D;
    }
    const dirty = this._vDirty;
    let anyAsleep = false;
    for (const pc of this.pieces) {
      const vs = pc.verts, i0 = vs[0];
      if (i0 >= oldNV || (dirty && dirty[i0])) continue;
      const op = oldVP[i0], o = old[op];
      if (!o || o.verts.length !== vs.length) continue;
      let same = true;
      for (let k = 1; k < vs.length && same; k++) same = vs[k] < oldNV && oldVP[vs[k]] === op;
      if (!same) continue;
      for (const f of CARRY) pc[f] = o[f];
      pc.com.set(o.com); pc.vel.set(o.vel); pc.bbox.set(o.bbox); pc.omega.set(o.omega); pc.impPrev.set(o.impPrev); pc.fitQ.set(o.fitQ); pc.rigQ.set(o.rigQ);
      kept[op] = 1;
      carried[pc.id] = 1;
      if (pc.asleep) anyAsleep = true;
    }
    if (this._lightBuild) {
      const D = this._vDirty && this._vDirty.length >= this.vCap ? this._vDirty : (this._vDirty = new Uint8Array(this.vCap));
      for (const pc of this.pieces) if (!carried[pc.id]) for (const i of pc.verts) D[i] = 1;
    }
    if (anyAsleep) {
      const x = this.x, r = 0.02 * this.p.size, ir = 1 / r;
      const cells = new Map();
      const key = (i) => (Math.floor(x[i * 3] * ir) + 512) * 1048576 + (Math.floor(x[i * 3 + 1] * ir) + 512) * 1024 + (Math.floor(x[i * 3 + 2] * ir) + 512);
      const add = (vs) => {
        for (const i of vs) {
          const k = key(i), l = cells.get(k);
          if (l) l.push(i);
          else cells.set(k, [i]);
        }
      };
      for (let k = 0; k < old.length; k++) if (!kept[k]) add(old[k].verts);
      for (const pc of this.pieces) if (!carried[pc.id]) add(pc.verts);
      for (const pc of this.pieces) {
        if (!carried[pc.id] || !pc.asleep) continue;
        let near = false;
        for (let n = 0; n < pc.verts.length && !near; n++) {
          const i = pc.verts[n], ox = x[i * 3], oy = x[i * 3 + 1], oz = x[i * 3 + 2];
          const cx = Math.floor(ox * ir), cy = Math.floor(oy * ir), cz = Math.floor(oz * ir);
          for (let a = -1; a <= 1 && !near; a++)
            for (let b = -1; b <= 1 && !near; b++)
              for (let c = -1; c <= 1 && !near; c++) {
                const l = cells.get((cx + a + 512) * 1048576 + (cy + b + 512) * 1024 + (cz + c + 512));
                if (!l) continue;
                for (const j of l) {
                  const dx = x[j * 3] - ox, dy = x[j * 3 + 1] - oy, dz = x[j * 3 + 2] - oz;
                  if (dx * dx + dy * dy + dz * dz < r * r) {
                    near = true;
                    break;
                  }
                }
              }
        }
        if (near) {
          pc.asleep = false;
          pc.sleepT = 0;
        }
      }
    }
    this._bpNV = nV;
  }

  _extractSurface() {
    const { T, X } = this;
    const nT = this.nT;
    // Tet faces met once are on the boundary; ones met twice are shared.
    // Open-addressing table on the sorted corner triple (a Map with big
    // numeric keys costs several ms per cut); the boundary faces come out in
    // tet order.
    let cap = 1024;
    while (cap < nT * 8) cap <<= 1;
    if (!this._sfKey || this._sfKey.length < cap * 3) {
      this._sfKey = new Int32Array(cap * 3);
      this._sfVal = new Int32Array(cap);
    }
    const hk = this._sfKey, hv = this._sfVal, mask = cap - 1;
    hv.fill(-1, 0, cap); // -1 empty, -2 shared (keep probing past it), else the face code t*4+f
    let nF = 0;
    for (let t = 0; t < nT; t++) {
      if (this.vol0[t] <= 0) continue;
      for (let f = 0; f < 4; f++) {
        const a = T[t * 4 + FACES[f][0]], b = T[t * 4 + FACES[f][1]], c = T[t * 4 + FACES[f][2]];
        let lo = a, mid = b, hi = c, tt;
        if (lo > mid) { tt = lo; lo = mid; mid = tt; }
        if (mid > hi) { tt = mid; mid = hi; hi = tt; }
        if (lo > mid) { tt = lo; lo = mid; mid = tt; }
        let h = (Math.imul(lo, 0x9e3779b1) ^ Math.imul(mid, 0x85ebca77) ^ Math.imul(hi, 0xc2b2ae3d)) & mask;
        for (;;) {
          const e = hv[h];
          if (e === -1) {
            hk[h * 3] = lo; hk[h * 3 + 1] = mid; hk[h * 3 + 2] = hi;
            hv[h] = t * 4 + f;
            nF++;
            break;
          }
          if (e >= 0 && hk[h * 3] === lo && hk[h * 3 + 1] === mid && hk[h * 3 + 2] === hi) {
            hv[h] = -2;
            nF--;
            break;
          }
          h = (h + 1) & mask;
        }
      }
    }
    const codes = new Int32Array(nF);
    for (let h = 0, n = 0; h < cap; h++) if (hv[h] >= 0) codes[n++] = hv[h];
    codes.sort();
    const sTri = new Int32Array(nF * 3);
    const sTet = new Int32Array(nF);
    const sTag = new Uint8Array(nF);
    const sRestN = new Float32Array(nF * 3);
    const vCube = this.vCube, cBevel = this.cBevel, cSize = this.cSize;
    const nrm = [0, 0, 0];
    // (a scalloped cube's points: on its skin or not, each worked out once -
    // 1 on, -1 not)
    const shapes = [];
    let f = 0;
    const tetBoundary = new Int32Array(nT).fill(-1); // first boundary face of tet (linked)
    const nextBoundary = new Int32Array(nF).fill(-1);
    for (let k = 0; k < nF; k++) {
      const code = codes[k];
      const t = code >> 2, lf = code & 3;
      const a = T[t * 4 + FACES[lf][0]], b = T[t * 4 + FACES[lf][1]], c = T[t * 4 + FACES[lf][2]];
      sTri[f * 3] = a; sTri[f * 3 + 1] = b; sTri[f * 3 + 2] = c;
      sTet[f] = t;
      nextBoundary[f] = tetBoundary[t];
      tetBoundary[t] = f;
      // rest normal & exterior classification
      const ax = X[a * 3], ay = X[a * 3 + 1], az = X[a * 3 + 2];
      const ux = X[b * 3] - ax, uy = X[b * 3 + 1] - ay, uz = X[b * 3 + 2] - az;
      const vx = X[c * 3] - ax, vy = X[c * 3 + 1] - ay, vz = X[c * 3 + 2] - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      sRestN[f * 3] = nx; sRestN[f * 3 + 1] = ny; sRestN[f * 3 + 2] = nz;
      // (against its own cube's shape, where that sits in rest space)
      const cb = vCube[a], bevel = cBevel[cb], half = cSize[cb] / 2;
      const cx = (ax + X[b * 3] + X[c * 3]) / 3 - cb * REST_STEP, cy = (ay + X[b * 3 + 1] + X[c * 3 + 1]) / 3, cz = (az + X[b * 3 + 2] + X[c * 3 + 2]) / 3;
      // (its own shape: a dished or bulged one's is its skin)
      const lb = this.cBow[cb] ? (shapes[cb] ||= this.formOf(cb)) : null;
      let tag = TAG_FRESH;
      if (lb || this.cLobeA[cb] > 0) {
        // (a shaped one's skin - dished, bulged, its edges crimped: near its
        // shape - a coarse face's middle lies well inside its curves, a
        // crimp's waves stand off it - and facing much its way)
        if (Math.abs(shapeSDF(cx, cy, cz, half, bevel, lb)) < 0.09 * half) {
          shapeNormal(cx, cy, cz, half, bevel, lb, nrm);
          if (nx * nrm[0] + ny * nrm[1] + nz * nrm[2] > 0.45) tag = TAG_EXTERIOR;
        }
      } else {
        const sd = roundBoxSDF(cx, cy, cz, half, bevel);
        if (Math.abs(sd) < 0.06 * half) {
          roundBoxNormal(cx, cy, cz, half, bevel, nrm);
          if (nx * nrm[0] + ny * nrm[1] + nz * nrm[2] > 0.55) tag = TAG_EXTERIOR;
        }
      }
      // (melted by the torch: wherever it is - a shallow crater's floor lies
      // near the cube's own shape, facing its way, and passed for its skin:
      // its surface map ran on down into the wound)
      if (this.melt[a] && this.melt[b] && this.melt[c]) tag = TAG_MELT;
      sTag[f] = tag;
      f++;
    }
    this.nF = nF;
    this.sTri = sTri;
    this.sTet = sTet;
    this.sTag = sTag;
    this.sRestN = sRestN;
    this.tetBoundary = tetBoundary;
    this.nextBoundary = nextBoundary;
    // boundary faces around each vertex (contact looks at the faces near a tet)
    const vfStart = new Int32Array(this.nV + 1);
    for (let k = 0; k < nF * 3; k++) vfStart[sTri[k] + 1]++;
    for (let i = 0; i < this.nV; i++) vfStart[i + 1] += vfStart[i];
    const vfFill = vfStart.slice(0, this.nV);
    const vfList = new Int32Array(nF * 3);
    for (let k = 0; k < nF * 3; k++) vfList[vfFill[sTri[k]]++] = (k / 3) | 0;
    this.vfStart = vfStart;
    this.vfList = vfList;
    this._fSeen = new Int32Array(nF);
    this._fStamp = 0;
    // per-substep cache of face geometry for contact (anchor, edges, unit
    // normal, projection terms), valid while _fGeoStamp[f] === _pass
    this._fGeo = new Float64Array(nF * 16);
    this._fGeoStamp = new Int32Array(nF);
    this._pass = (this._pass || 0) + 1;
  }

  // Split surface vertices into render vertices by smoothing group: faces
  // around a vertex are smoothed together only if they share an edge, have
  // the same tag and their rest normals are within a crease angle.
  _buildRenderClusters() {
    const nF = this.nF, sTri = this.sTri, sTag = this.sTag, N = this.sRestN;
    const nV = this.nV;
    // vertex -> incident faces
    const start = new Int32Array(nV + 1);
    for (let k = 0; k < nF * 3; k++) start[sTri[k] + 1]++;
    for (let i = 0; i < nV; i++) start[i + 1] += start[i];
    const fill = start.slice(0, nV);
    const inc = new Int32Array(nF * 3); // encoded face*3+corner
    for (let f = 0; f < nF; f++) for (let c = 0; c < 3; c++) inc[fill[sTri[f * 3 + c]]++] = f * 3 + c;

    // (a hollow's skin - a cube full of liquid's, carved to its shape's inside: its faces with all three corners as
    // deep as its wall or deeper, facing in - smoothed all over (2): its edges' and corners' rounding one or two
    // faces across, they met at 65-90 degrees and were drawn as cut faces are, creased - and drawn round, on its
    // shape as it's drawn (see hollowRound), not smoothed as a cut's are (see JellyView._buildSmooth,
    // snapToHollow). A cut into it is let be: at its rim a corner of each of its faces is out in the wall.)
    const hollowF = this.sHollow && this.sHollow.length >= nF ? this.sHollow : (this.sHollow = new Uint8Array(Math.max(64, nF * 2)));
    hollowF.fill(0, 0, nF);
    const VS = this.vShort && this.vShort.length >= nV ? this.vShort : (this.vShort = new Float32Array(Math.max(64, nV * 2)));
    VS.fill(0, 0, nV);
    {
      const X = this.X, nrm = [0, 0, 0];
      let k = -1, half = 0, bevel = 0, bevH = 0, th = 0, lim = 0, lb = null;
      const sd = (i, bv) => (lb ? shapeSDF(X[i * 3] - k * REST_STEP, X[i * 3 + 1], X[i * 3 + 2], half, bv, lb) : roundBoxSDF(X[i * 3] - k * REST_STEP, X[i * 3 + 1], X[i * 3 + 2], half, bv));
      for (let f = 0; f < nF; f++) {
        if (sTag[f] !== TAG_FRESH) continue;
        const a = sTri[f * 3], b = sTri[f * 3 + 1], c = sTri[f * 3 + 2];
        if (!this.cHollow[this.vCube[a]]) continue;
        if (this.vCube[a] !== k) {
          k = this.vCube[a];
          half = this.cSize[k] / 2;
          bevel = this.cBevel[k];
          bevH = this.hollowBevel(k);
          lb = this.shapeOf(k);
          th = this.wallTh(k);
          lim = -0.95 * th + 0.01;
        }
        if (sd(a, bevel) > lim || sd(b, bevel) > lim || sd(c, bevel) > lim) continue;
        const cx = (X[a * 3] + X[b * 3] + X[c * 3]) / 3 - k * REST_STEP, cy = (X[a * 3 + 1] + X[b * 3 + 1] + X[c * 3 + 1]) / 3, cz = (X[a * 3 + 2] + X[b * 3 + 2] + X[c * 3 + 2]) / 3;
        if (lb) shapeNormal(cx, cy, cz, half, bevel, lb, nrm);
        else roundBoxNormal(cx, cy, cz, half, bevel, nrm);
        if (!(-(N[f * 3] * nrm[0] + N[f * 3 + 1] * nrm[1] + N[f * 3 + 2] * nrm[2]) > 0.3)) continue;
        hollowF[f] = 2;
        VS[a] = -(sd(a, bevH) + th);
        VS[b] = -(sd(b, bevH) + th);
        VS[c] = -(sd(c, bevH) + th);
      }
    }
    const cornerR = new Int32Array(nF * 3);
    const rSim = [];
    const rTag = [];
    const par = new Int32Array(64), rid = new Int32Array(64);
    const find = (a) => {
      while (par[a] !== a) {
        par[a] = par[par[a]];
        a = par[a];
      }
      return a;
    };
    for (let v = 0; v < nV; v++) {
      const s = start[v], e = start[v + 1], n = e - s;
      if (n === 0) continue;
      if (n > 64) {
        // pathological: one cluster
        const r = rSim.length;
        rSim.push(v);
        rTag.push(sTag[(inc[s] / 3) | 0]);
        for (let k = s; k < e; k++) cornerR[inc[k]] = r;
        continue;
      }
      for (let a = 0; a < n; a++) par[a] = a;
      // (a sawtooth's moved points creased all round: crisp teeth - see
      // mesh.js crimp)
      const cv = this.vCube[v];
      let thrX = 0.45;
      if (this.cLobeA[cv] > 0 && crimpSharp(CRIMPS[this.cTrimK[cv]])) {
        const fm = this.formOf(cv), R0 = cv * REST_STEP, hf = this.cSize[cv] / 2, X = this.X;
        const sd = fm ? shapeSDF(X[v * 3] - R0, X[v * 3 + 1], X[v * 3 + 2], hf, this.cBevel[cv], fm) : roundBoxSDF(X[v * 3] - R0, X[v * 3 + 1], X[v * 3 + 2], hf, this.cBevel[cv]);
        if (Math.abs(sd) > 0.08 * this.cLobeA[cv]) thrX = 0.9;
      }
      for (let a = 0; a < n; a++) {
        const fa = (inc[s + a] / 3) | 0;
        const ca = inc[s + a] % 3;
        const a1 = sTri[fa * 3 + ((ca + 1) % 3)], a2 = sTri[fa * 3 + ((ca + 2) % 3)];
        for (let b = a + 1; b < n; b++) {
          const fb = (inc[s + b] / 3) | 0;
          if (sTag[fa] !== sTag[fb]) continue;
          const cb = inc[s + b] % 3;
          const b1 = sTri[fb * 3 + ((cb + 1) % 3)], b2 = sTri[fb * 3 + ((cb + 2) % 3)];
          if (!(a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2)) continue;
          const d = N[fa * 3] * N[fb * 3] + N[fa * 3 + 1] * N[fb * 3 + 1] + N[fa * 3 + 2] * N[fb * 3 + 2];
          const thr = sTag[fa] === TAG_EXTERIOR ? thrX : sTag[fa] === TAG_MELT ? 0.15 : hollowF[fa] && hollowF[fb] ? -0.25 : 0.82;
          if (d < thr) continue;
          const ra = find(a), rb = find(b);
          if (ra !== rb) par[rb] = ra;
        }
      }
      rid.fill(-1, 0, n);
      for (let a = 0; a < n; a++) {
        const r = find(a);
        if (rid[r] < 0) {
          rid[r] = rSim.length;
          rSim.push(v);
          rTag.push(sTag[(inc[s + a] / 3) | 0]);
        }
        cornerR[inc[s + a]] = rid[r];
      }
    }
    // index buffer sorted by piece (counting sort; in face order within one)
    const tp = this.tPiece, sTet = this.sTet, NPc = this.pieces.length;
    const pStart = new Int32Array(NPc + 1);
    for (let f = 0; f < nF; f++) pStart[tp[sTet[f]] + 1]++;
    for (let k = 0; k < NPc; k++) pStart[k + 1] += pStart[k];
    const order = new Int32Array(nF);
    for (let f = 0; f < nF; f++) order[pStart[tp[sTet[f]]]++] = f;
    const rIndex = new Uint32Array(nF * 3);
    const ranges = this.pieces.map(() => ({ start: 0, count: 0 }));
    for (let k = 0; k < nF; k++) {
      const f = order[k];
      rIndex[k * 3] = cornerR[f * 3];
      rIndex[k * 3 + 1] = cornerR[f * 3 + 1];
      rIndex[k * 3 + 2] = cornerR[f * 3 + 2];
      const pc = tp[sTet[f]];
      if (ranges[pc].count === 0) ranges[pc].start = k * 3;
      ranges[pc].count += 3;
    }
    this.rCount = rSim.length;
    this.rSim = Int32Array.from(rSim);
    this.rTag = Uint8Array.from(rTag);
    this.rIndex = rIndex;
    this.rFaceOrder = Int32Array.from(order);
    this.pieceRanges = ranges;
  }

  // Fill render buffers (positions + smooth normals per render vertex).
  writeRender(pos, nrm, extra, coat = null, coatM = null) {
    const x = this.x, rSim = this.rSim, rIndex = this.rIndex, n = this.rCount;
    for (let r = 0; r < n; r++) {
      const i = rSim[r] * 3;
      pos[r * 3] = x[i]; pos[r * 3 + 1] = x[i + 1]; pos[r * 3 + 2] = x[i + 2];
    }
    nrm.fill(0, 0, n * 3);
    const nI = this.nF * 3;
    // (each face's way out, weighted at each of its corners by its angle there - not its area: the skin's squares
    // are each two triangles split corner to corner, so by area the two corners on the split took two shares of
    // each square and the others one, and bent - bulging, squeezed - the faces' light and what's seen through them
    // showed the split's diagonals, the tets' pattern, from the side)
    const ang = (ux, uy, uz, vx, vy, vz) => {
      const d = (ux * vx + uy * vy + uz * vz) / Math.sqrt((ux * ux + uy * uy + uz * uz) * (vx * vx + vy * vy + vz * vz) || 1e-30);
      return Math.acos(d < -1 ? -1 : d > 1 ? 1 : d);
    };
    for (let k = 0; k < nI; k += 3) {
      const a = rIndex[k], b = rIndex[k + 1], c = rIndex[k + 2];
      const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2], bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2], cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (!(nl > 1e-20)) continue;
      nx /= nl; ny /= nl; nz /= nl;
      const wa = ang(ux, uy, uz, vx, vy, vz), wb = ang(cx - bx, cy - by, cz - bz, -ux, -uy, -uz), wc = Math.PI - wa - wb;
      nrm[a * 3] += nx * wa; nrm[a * 3 + 1] += ny * wa; nrm[a * 3 + 2] += nz * wa;
      nrm[b * 3] += nx * wb; nrm[b * 3 + 1] += ny * wb; nrm[b * 3 + 2] += nz * wb;
      nrm[c * 3] += nx * wc; nrm[c * 3 + 1] += ny * wc; nrm[c * 3 + 2] += nz * wc;
    }
    for (let r = 0; r < n; r++) {
      const o = r * 3;
      const l = Math.hypot(nrm[o], nrm[o + 1], nrm[o + 2]);
      if (l > 0) {
        nrm[o] /= l; nrm[o + 1] /= l; nrm[o + 2] /= l;
      } else nrm[o + 1] = 1;
    }
    if (extra) {
      // extra: [temp, glow, fresh, dust] per render vertex
      const temp = this.temp, glow = this.glow, dust = this.dust, rTag = this.rTag;
      for (let r = 0; r < n; r++) {
        const i = rSim[r];
        extra[r * 4] = temp[i];
        extra[r * 4 + 1] = glow[i];
        // (a melted surface: as smooth as the skin, a quarter of the way to a
        // cut - no surface map on it; see the jelly shader's fresh)
        extra[r * 4 + 2] = rTag[r] === TAG_FRESH ? 1 : rTag[r] === TAG_MELT ? 0.25 : 0;
        extra[r * 4 + 3] = dust[i];
      }
    }
    if (coat) {
      // [colour, sparkle] and [multi] per render vertex (times the amount)
      const C = this.coat;
      for (let r = 0; r < n; r++) {
        const i = rSim[r] * 5;
        coat[r * 4] = C[i]; coat[r * 4 + 1] = C[i + 1]; coat[r * 4 + 2] = C[i + 2]; coat[r * 4 + 3] = C[i + 3];
        coatM[r] = C[i + 4];
      }
    }
  }

  // ---------------------------------------------------------------- dynamics
  step(dt) {
    const P = this.p;
    const nS = P.substeps;
    const h = dt / nS;
    // (?stats: each part's time - see PROF_PHASES)
    const PT = this.profT;
    let pt = PT ? performance.now() : 0;
    const lap = PT
      ? (k) => {
          const n = performance.now();
          PT[k] += n - pt;
          pt = n;
        }
      : null;
    this.time += dt;
    if (this._liqDirty || this._liqTopo !== this.topoVersion) this._liquidTets();
    if (this._restEase) this._tickRestEase(dt);
    this.impacts.length = 0;
    const NP0 = this.pieces.length;
    if (!this._imp || this._imp.length < NP0 * 12) {
      this._imp = new Float64Array(Math.max(NP0, 64) * 12);
      this._impPartner = new Int32Array(Math.max(NP0, 64));
    }
    this._imp.fill(0, 0, NP0 * 12);
    this._impPartner.fill(-1, 0, NP0);
    this._updateMaterial(dt);
    if (this.calmT > 0) this.calmT -= dt;
    if (this.dmgHeal > 0) {
      // (torn ends firming up again: see HandTool)
      this.dmgHeal -= dt;
      const D = this.tDmg, f = this.dmgHeal > 0 ? Math.exp(-dt * 3.5) : 0;
      for (let t = 0; t < this.nT; t++) if (D[t] > 0) D[t] *= f;
    }
    this._foldCheck(dt);
    if (this.grabs.length) {
      const G = this._markGrabbed();
      for (let k = 0; k < this.pieces.length; k++) {
        if (!G[k]) continue;
        this.wake(k);
        this.pieces[k].touchT = this.time;
      }
    } else if (this._grabbedP) this._grabbedP.fill(0);
    if (this.attract || this.gravityScale !== 1 || this.embeds.some((e) => !e.pair)) this.wakeAll();
    else if (this.embeds.length) this._wakeNailed();
    // (pieces glued together - a gel glob, set where it landed - by their
    // glue nails: they don't push each other out, see _solvePieceCollisions)
    this._glue = null;
    for (const e of this.embeds) {
      if (!e.glue || e.a.tet < 0 || e.b.tet < 0 || e.a.tet >= this.nT || e.b.tet >= this.nT) continue;
      const pa = this.tPiece[e.a.tet], pb = this.tPiece[e.b.tet];
      if (pa === pb) continue;
      if (!this._glue) this._glue = new Set();
      this._glue.add(pa * 65536 + pb);
      this._glue.add(pb * 65536 + pa);
    }
    const NP = this.pieces.length;
    const aw = this._awake && this._awake.length >= NP ? this._awake : (this._awake = new Uint8Array(Math.max(NP, 64)));
    let anyAwake = false;
    for (let k = 0; k < NP; k++) {
      aw[k] = this.pieces[k].asleep ? 0 : 1;
      if (aw[k]) anyAwake = true;
    }
    this.anyAwake = anyAwake;
    if (!anyAwake) {
      this._dampPieces(dt);
      return;
    }
    // (each piece's hold on the floor: its cube's tack, or its splat's while that lasts - none re-cubing on its own)
    if (this._pTack.length < NP) this._pTack = new Float64Array(NP * 2);
    for (let k = 0; k < NP; k++) {
      const pc = this.pieces[k], c = pc.cube;
      this._pTack[k] = this.cGrav[c] !== 1 ? 0 : Math.max(this.cTack[c], pc.splatT > 0 ? pc.splatK * (pc.splatT / SPLAT_T) : 0);
    }
    const multi = (this.pieces.length > 1 || P.selfCollide) && P.collide && this.collisionsEnabled;
    this._grabPress = 0;
    const NPp = this.pieces.length;
    if (!this._pressP || this._pressP.length < NPp) this._pressP = new Float64Array(Math.max(NPp, 64));
    this._pressP.fill(0, 0, NPp);
    // (substeps a look for contact candidates covers - see _hashSegs)
    let segN = nS;
    if (multi) {
      // A frame's worth (or more) of motion: short frames (slow motion)
      // keep using the candidates until it is used up - unless something
      // moved the pieces some other way meanwhile. A long frame with
      // something fast in it: looked for afresh every segN substeps.
      const age = this._hashAge + dt, segs = this._hashSegs(dt, aw);
      if (segs > 1 || this._hashDirty || age > this._hashSpan * 1.0001 || this.grabs.length || this.pushers.length || this.attract || this._hashTopo !== this.topoVersion) {
        segN = Math.ceil(nS / segs);
        this._hashSpan = segs > 1 ? segN * h : Math.max(dt, 1 / 60);
        this._hashAge = segs > 1 ? segN * h : dt;
        this._hashTopo = this.topoVersion;
        this._hashDirty = false;
        if (lap) lap(0);
        this._buildCollisionHash();
        if (lap) lap(1);
      } else this._hashAge = age;
    } else this._hashDirty = true;
    if (lap) {
      lap(0);
      PT[10] += nS;
    }
    for (let s = 0; s < nS; s++) {
      if (multi && s && s % segN === 0) {
        this._hashSpan = this._hashAge = Math.min(segN, nS - s) * h;
        this._buildCollisionHash();
        if (lap) lap(1);
      }
      if (this._anyWind) this._wind(h);
      this._integrate(h);
      if (lap) lap(2);
      // (the hand pulls first, then the jelly answers: pulled after its
      // elasticity had its say, a held patch pressed against something was
      // crushed flat each substep - a thin slice turned inside out and blew
      // up like a balloon - and a corner could be dragged straight through
      // the body, leaving it passed through itself)
      for (let n = 0; n < this.grabs.length; n++) this._solveGrab(this.grabs[n], h);
      if (lap) lap(3);
      this._solveTets(h);
      if (lap) lap(4);
      this._solveStitches(h);
      this._solveCavities(h);
      if (this._anyRigid) this._solveRigidity(h);
      if (this.embeds.length) this._solveEmbeds(h);
      if (this.attract) this._solveAttract(h);
      if (this.pushers.length) this._solvePushers((s + 1) / nS);
      if (lap) lap(5);
      if (multi && this._anyContact) this._solvePieceCollisions(h);
      if (lap) lap(6);
      this._solveBounds(h);
      if (lap) lap(7);
      this._updateVelocities(h);
      if (lap) lap(8);
    }
    this._dampPieces(dt);
    this._tangleCheck(dt);
    this._untangle(dt);
    this._emitImpacts(dt, h);
    if (lap) lap(9);
  }

  // How many looks for contact candidates this frame: one - or, a piece moving fast against another it could
  // meet, over a long frame, one for each cell or so of that move (up to 6). The candidates cover all the motion
  // until the next look, so one look over a phone's 50 ms frame had a cube thrown onto another find every tet
  // half a metre down through it, for every probe on both: 600k candidates, a 180 ms frame as it landed. (By
  // the pieces' own speeds, as of the last step - a wobble doesn't count, nor pieces flying apart.)
  _hashSegs(dt, aw) {
    const P = this.pieces, NP = P.length;
    let reach = 0;
    for (let a = 0; a < NP; a++) {
      const A = P[a], va = A.vel, ba = A.bbox, ca = A.com;
      // (a small piece's few probes, and few tets, can't run up many candidates however fast: a pile of diced
      // bits flying about was looked over again and again for nothing)
      if (A.verts.length < 150) continue;
      for (let b = a + 1; b < NP; b++) {
        if (!aw[a] && !aw[b]) continue;
        const B = P[b], vb = B.vel, bb = B.bbox;
        if (B.verts.length < 150) continue;
        const rx = (va[0] - vb[0]) * dt, ry = (va[1] - vb[1]) * dt, rz = (va[2] - vb[2]) * dt, m = Math.abs(rx) + Math.abs(ry) + Math.abs(rz);
        // (only two that could meet this frame)
        if (ba[0] - m > bb[3] || bb[0] - m > ba[3] || ba[1] - m > bb[4] || bb[1] - m > ba[4] || ba[2] - m > bb[5] || bb[2] - m > ba[5]) continue;
        // (its whole move against b - unless that's clearly away from it)
        const cb = B.com, dx = cb[0] - ca[0], dy = cb[1] - ca[1], dz = cb[2] - ca[2], d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const r = Math.sqrt(rx * rx + ry * ry + rz * rz);
        if ((rx * dx + ry * dy + rz * dz) / d > -0.25 * r && r > reach) reach = r;
      }
    }
    reach /= 1.2 * this.hCell;
    return reach > 1 ? Math.min(6, Math.ceil(reach)) : 1;
  }

  // Impacts for sound, from the impulse floor, walls and other pieces gave
  // each piece this frame (as a speed change; holding a piece up against
  // gravity doesn't count). _imp per piece, 3 slots (floor, wall, pieces) of
  // [J, Jx, Jy, Jz]: J = sum of m*dx, then the J-weighted contact position.
  // A sudden rise starts an impact; it is reported a frame or two later at
  // its peak (soft jelly takes a few frames to stop).
  _emitImpacts(dt, h) {
    const I = this._imp, g = Math.abs(this.p.gravity * this.gravityScale);
    const dvs = [0, 0, 0];
    for (let k = 0; k < this.pieces.length; k++) {
      const pc = this.pieces[k];
      if (!(pc.mass > 0)) continue;
      const o = k * 12;
      const prev = pc.impPrev;
      let best = 0, kind = -1;
      for (let c = 0; c < 3; c++) {
        let dv = I[o + c * 4] / h / pc.mass;
        if (c === 0) dv -= g * dt;
        if (c === 2) {
          // between pieces it's the change in their closing speed that counts
          const q = this._impPartner[k], pq = this.pieces[q];
          if (q >= 0 && pq && pq.mass > 0 && !pq.asleep) dv += I[q * 12 + 8] / h / pq.mass;
        }
        dvs[c] = dv;
        // only a sudden rise counts (steady pressing/supporting is silent)
        const rise = dv - 1.8 * prev[c];
        prev[c] = Math.max(0, dv);
        if (rise > 0 && dv > 0.8 && dv > best) {
          best = dv;
          kind = c;
        }
      }
      const pend = pc.impPend;
      if (pend) {
        const dv = dvs[pend.c];
        if (dv > pend.dv) {
          const J = I[o + pend.c * 4] || 1;
          pend.dv = dv;
          pend.x = I[o + pend.c * 4 + 1] / J; pend.y = I[o + pend.c * 4 + 2] / J; pend.z = I[o + pend.c * 4 + 3] / J;
        }
        if (++pend.n >= 2 || dv < pend.dv * 0.7) {
          pc.impPend = null;
          if (pend.dv >= 1) {
            pc.impT = this.time;
            pc.impDv = pend.dv;
            this.impacts.push({
              x: pend.x, y: pend.y, z: pend.z, dv: pend.dv, piece: k, kind: pend.c === 0 ? 'floor' : pend.c === 1 ? 'wall' : 'piece',
              mass: pc.mass, partner: pend.c === 2 ? this._impPartner[k] : -1,
            });
          }
        }
        continue;
      }
      if (kind < 0 || pc.asleep) continue;
      // one per contact, not a rattle: a fresh hit needs a pause or to be harder
      if (this.time - (pc.impT ?? -1) < 0.1 && best < (pc.impDv || 0) * 1.6) continue;
      const J = I[o + kind * 4] || 1;
      pc.impPend = { c: kind, dv: best, n: 0, x: I[o + kind * 4 + 1] / J, y: I[o + kind * 4 + 2] / J, z: I[o + kind * 4 + 3] / J };
    }
  }

  // Cube k in the air as a falling thing is (see Drop): each face of its skin pressed as hard as it drives into
  // the air - the square of its speed into it, vt its critical speed: there, the push on the face leading it is
  // its weight. 0: none.
  setWind(k, vt) {
    if (!(vt > 0)) this.cWind[k] = 0;
    else {
      let M = 0;
      for (let i = 0; i < this.nV; i++) if (this.vCube[i] === k && this.alive[i]) M += this.m[i];
      const A = this.cSize[k] * this.cSize[k], g = Math.abs(this.p.gravity);
      // (the face leading it pushed, the one behind pulled back 0.8 as hard: see _wind)
      this.cWind[k] = (M * g) / (1.8 * A * vt * vt);
    }
    this._anyWind = this.cWind.some((c) => c > 0);
  }

  // (a substep of it: each face of a windy cube's skin - not its hollow's, that faces its liquid - pushed back as
  // hard as it drives into the air, C v_n^2 over its area, and each face behind pulled back a third as hard; a
  // third to each corner. The face leading is pushed in more than its sides - square on, it meets the air
  // hardest: falling fast, it's squashed and spread)
  // (Its push all told as it's made - square on, its face's area: spread flat by it, it met that much more air and
  // was braked as hard as twice its weight, sprang back, and spread again - a pudding of lead, its shape reset in
  // mid-air over and over. And the air on each face as it moves against the rest of it: its jiggle damped - a
  // watery one's spreading and springing back, a few times a second, never settled)
  _wind(h) {
    const S = this.sTri, nF = this.nF, ST = this.sTet, tc = this.tCube, CW = this.cWind, x = this.x, v = this.v, w = this.w, HF = this.sHollow;
    const aw = this._awake, vp = this.vPiece, WS = this._wSum;
    WS.fill(0);
    // (each windy cube's skin: its area, its speed - the mean of its faces' by area - and its push as is)
    for (let pass = 0; pass < 2; pass++) {
      for (let f = 0; f < nF; f++) {
        const k = tc[ST[f]], C = CW[k];
        if (!(C > 0) || (HF && HF[f] === 2)) continue;
        const a = S[f * 3], b = S[f * 3 + 1], c = S[f * 3 + 2];
        if (!aw[vp[a]]) continue;
        const a3 = a * 3, b3 = b * 3, c3 = c * 3;
        const ux = x[b3] - x[a3], uy = x[b3 + 1] - x[a3 + 1], uz = x[b3 + 2] - x[a3 + 2], qx = x[c3] - x[a3], qy = x[c3 + 1] - x[a3 + 1], qz = x[c3 + 2] - x[a3 + 2];
        let nx = uy * qz - uz * qy, ny = uz * qx - ux * qz, nz = ux * qy - uy * qx;
        const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (!(nl > 1e-12)) continue;
        nx /= nl; ny /= nl; nz /= nl;
        const ux3 = (v[a3] + v[b3] + v[c3]) / 3, uy3 = (v[a3 + 1] + v[b3 + 1] + v[c3 + 1]) / 3, uz3 = (v[a3 + 2] + v[b3 + 2] + v[c3 + 2]) / 3;
        const vn = ux3 * nx + uy3 * ny + uz3 * nz, ar = 0.5 * nl, k6 = k * 6;
        if (!pass) {
          WS[k6] += ar;
          WS[k6 + 1] += ux3 * ar; WS[k6 + 2] += uy3 * ar; WS[k6 + 3] += uz3 * ar;
          if (vn > 0) WS[k6 + 4] += vn * vn * ar;
          continue;
        }
        const vt2 = Math.max(0, ux3 * ux3 + uy3 * uy3 + uz3 * uz3 - vn * vn);
        // (and the air streaming past its sides pulls them out - three times as hard as it pushes square on, more than
        // a bluff thing's sides are (about as hard): sideways, it doesn't slow the fall, and as hard as that a jelly's
        // hardly moved - and its wake pulls back on the face behind 0.8 as hard: at its critical speed, distended -
        // its sides bowed out, its back drawn up after it, puffed out like a pillow)
        const rel = vn - (WS[k6 + 1] * nx + WS[k6 + 2] * ny + WS[k6 + 3] * nz);
        const p = ((vn > 0 ? C * vn * vn : -0.8 * C * vn * vn) - 3 * C * vt2) * WS[k6 + 4] + C * WS[k6 + 5] * rel, J = (-p * ar * h) / 3;
        v[a3] += nx * J * w[a]; v[a3 + 1] += ny * J * w[a]; v[a3 + 2] += nz * J * w[a];
        v[b3] += nx * J * w[b]; v[b3 + 1] += ny * J * w[b]; v[b3 + 2] += nz * J * w[b];
        v[c3] += nx * J * w[c]; v[c3 + 1] += ny * J * w[c]; v[c3 + 2] += nz * J * w[c];
      }
      if (pass) break;
      // (its speed; its push as is, over what it'd be square on with a face's area as made - the most it's let be;
      // the air's hold on its jiggle, 8 times its push's rate a m/s, as fast as it goes)
      for (let k = 0; k < MAX_CUBES; k++) {
        const k6 = k * 6, A = WS[k6];
        if (!(CW[k] > 0) || !(A > 0)) continue;
        const vx = WS[k6 + 1] / A, vy = WS[k6 + 2] / A, vz = WS[k6 + 3] / A, v2 = vx * vx + vy * vy + vz * vz, A0 = this.cSize[k] * this.cSize[k];
        WS[k6 + 1] = vx; WS[k6 + 2] = vy; WS[k6 + 3] = vz;
        WS[k6 + 4] = WS[k6 + 4] > v2 * A0 ? (v2 * A0) / WS[k6 + 4] : 1;
        WS[k6 + 5] = 8 * Math.sqrt(v2);
      }
    }
  }

  _integrate(h) {
    this._shellSpring(h);
    const { x, px, v, w } = this;
    const g = this.p.gravity * this.gravityScale * h;
    const gx = this.tilt[0] * this.gravityScale * h, gz = this.tilt[1] * this.gravityScale * h;
    const n = this.nV;
    const aw = this._awake, vp = this.vPiece, cg = this.cGrav, vc = this.vCube;
    for (let i = 0; i < n; i++) {
      if (w[i] === 0 || !aw[vp[i]]) continue;
      const o = i * 3, k = cg[vc[i]];
      v[o] += gx * k;
      v[o + 1] += g * k;
      v[o + 2] += gz * k;
      px[o] = x[o]; px[o + 1] = x[o + 1]; px[o + 2] = x[o + 2];
      x[o] += v[o] * h; x[o + 1] += v[o + 1] * h; x[o + 2] += v[o + 2] * h;
    }
  }

  _solveTets(h) {
    const { T, B, vol0, x, w, tMu, tVS, tKs, tDmg, tCube, tLq, tPr } = this;
    const HT = this.cHardTyp || (this.cHardTyp = new Float64Array(MAX_CUBES));
    // (each cube its own stiffness) frozen tets stiffen, but only up to what
    // these substeps can hold (beyond it jagged shards ring at the speed limit)
    const sr = 1 / (h * 720);
    const KM = this._kMu || (this._kMu = new Float64Array(MAX_CUBES)), KL = this._kLam || (this._kLam = new Float64Array(MAX_CUBES));
    const KB = this._kBoost || (this._kBoost = new Float64Array(MAX_CUBES));
    for (let k = 0; k < MAX_CUBES; k++) {
      const m0 = this.cMu[k], foam = Math.min(1, this.cLam[k] / 6);
      KM[k] = m0;
      KL[k] = m0 * this.cLam[k];
      KB[k] = Math.max(m0, 850 * this.cDens[k] * this.cSize[k] * this.cSize[k] * (0.35 + 0.65 * foam) * Math.min(1, sr * sr)) / m0;
    }
    const ih2 = 1 / (h * h);
    const nT = this.nT;
    const aw = this._awake, tp = this.tPiece;
    for (let t = 0; t < nT; t++) {
      const V0 = vol0[t];
      if (V0 <= 0 || !aw[tp[t]]) continue;
      const kc = tCube[t], mu0 = KM[kc], lam = KL[kc], boostHi = KB[kc];
      const t4 = t * 4;
      const a = T[t4], b = T[t4 + 1], c = T[t4 + 2], d = T[t4 + 3];
      const i0 = a * 3, i1 = b * 3, i2 = c * 3, i3 = d * 3;
      const w0 = w[a], w1 = w[b], w2 = w[c], w3 = w[d];
      const vs = tVS[t];
      const sc = vs === 1 ? 1 : 1 / Math.cbrt(vs);
      const bo = t * 9;
      const b00 = B[bo] * sc, b01 = B[bo + 1] * sc, b02 = B[bo + 2] * sc;
      const b10 = B[bo + 3] * sc, b11 = B[bo + 4] * sc, b12 = B[bo + 5] * sc;
      const b20 = B[bo + 6] * sc, b21 = B[bo + 7] * sc, b22 = B[bo + 8] * sc;
      const V = V0 * vs;
      // frozen (stiffer) tets stiffen in volume too, keeping lambda/mu: a stiff
      // shear term against a soft volume term rings violently
      const boost = tMu[t] > 1 ? Math.min(tMu[t], boostHi) : tMu[t];
      // (a tear on its way through: it gives - see HandTool)
      const ks = tDmg[t] > 0 ? tKs[t] * (1 - 0.85 * tDmg[t]) : tKs[t];
      // (its shape's firmness by its share - a liquid's inside next to none - its volume's all of it)
      const mu = mu0 * boost * ks * tLq[t];
      const lamT = (boost > 1 ? lam * boost : lam) * ks;

      // ---- deviatoric: C = sqrt(tr(F^T F))
      let e1x = x[i1] - x[i0], e1y = x[i1 + 1] - x[i0 + 1], e1z = x[i1 + 2] - x[i0 + 2];
      let e2x = x[i2] - x[i0], e2y = x[i2 + 1] - x[i0 + 1], e2z = x[i2 + 2] - x[i0 + 2];
      let e3x = x[i3] - x[i0], e3y = x[i3 + 1] - x[i0 + 1], e3z = x[i3 + 2] - x[i0 + 2];
      let f00 = e1x * b00 + e2x * b10 + e3x * b20, f01 = e1x * b01 + e2x * b11 + e3x * b21, f02 = e1x * b02 + e2x * b12 + e3x * b22;
      let f10 = e1y * b00 + e2y * b10 + e3y * b20, f11 = e1y * b01 + e2y * b11 + e3y * b21, f12 = e1y * b02 + e2y * b12 + e3y * b22;
      let f20 = e1z * b00 + e2z * b10 + e3z * b20, f21 = e1z * b01 + e2z * b11 + e3z * b21, f22 = e1z * b02 + e2z * b12 + e3z * b22;
      let C = Math.sqrt(f00 * f00 + f01 * f01 + f02 * f02 + f10 * f10 + f11 * f11 + f12 * f12 + f20 * f20 + f21 * f21 + f22 * f22);
      if (C > 1e-9 && mu > 0) {
        const ic = 1 / C;
        const g1x = (f00 * b00 + f01 * b01 + f02 * b02) * ic, g1y = (f10 * b00 + f11 * b01 + f12 * b02) * ic, g1z = (f20 * b00 + f21 * b01 + f22 * b02) * ic;
        const g2x = (f00 * b10 + f01 * b11 + f02 * b12) * ic, g2y = (f10 * b10 + f11 * b11 + f12 * b12) * ic, g2z = (f20 * b10 + f21 * b11 + f22 * b12) * ic;
        const g3x = (f00 * b20 + f01 * b21 + f02 * b22) * ic, g3y = (f10 * b20 + f11 * b21 + f12 * b22) * ic, g3z = (f20 * b20 + f21 * b21 + f22 * b22) * ic;
        const g0x = -g1x - g2x - g3x, g0y = -g1y - g2y - g3y, g0z = -g1z - g2z - g3z;
        const hard = w0 * (g0x * g0x + g0y * g0y + g0z * g0z) + w1 * (g1x * g1x + g1y * g1y + g1z * g1z) +
          w2 * (g2x * g2x + g2y * g2y + g2z * g2z) + w3 * (g3x * g3x + g3y * g3y + g3z * g3z);
        // (no harder than a substep can hold: this term on its own pulls the
        // tet to a point - it's held at its size only by the volume's push,
        // and only while it's soft. Too stiff for the tet's mass and size - a
        // sliver a cut left, light stiff jelly - it went hard, crushed it
        // inside out, and diced rubber blew up into spikes.)
        const alpha = Math.max(ih2 / (mu * V), DEV_SOFT_MIN * hard, Math.min(DEV_SOFT * hard, DEV_CAP * HT[kc]));
        const dl = -C / (hard + alpha);
        let s = w0 * dl; x[i0] += g0x * s; x[i0 + 1] += g0y * s; x[i0 + 2] += g0z * s;
        s = w1 * dl; x[i1] += g1x * s; x[i1 + 1] += g1y * s; x[i1 + 2] += g1z * s;
        s = w2 * dl; x[i2] += g2x * s; x[i2 + 1] += g2y * s; x[i2 + 2] += g2z * s;
        s = w3 * dl; x[i3] += g3x * s; x[i3 + 1] += g3y * s; x[i3 + 2] += g3z * s;
      }

      // ---- hydrostatic: C = det(F) - gamma
      e1x = x[i1] - x[i0]; e1y = x[i1 + 1] - x[i0 + 1]; e1z = x[i1 + 2] - x[i0 + 2];
      e2x = x[i2] - x[i0]; e2y = x[i2 + 1] - x[i0 + 1]; e2z = x[i2 + 2] - x[i0 + 2];
      e3x = x[i3] - x[i0]; e3y = x[i3 + 1] - x[i0 + 1]; e3z = x[i3 + 2] - x[i0 + 2];
      f00 = e1x * b00 + e2x * b10 + e3x * b20; f01 = e1x * b01 + e2x * b11 + e3x * b21; f02 = e1x * b02 + e2x * b12 + e3x * b22;
      f10 = e1y * b00 + e2y * b10 + e3y * b20; f11 = e1y * b01 + e2y * b11 + e3y * b21; f12 = e1y * b02 + e2y * b12 + e3y * b22;
      f20 = e1z * b00 + e2z * b10 + e3z * b20; f21 = e1z * b01 + e2z * b11 + e3z * b21; f22 = e1z * b02 + e2z * b12 + e3z * b22;
      // columns of F: c0=(f00,f10,f20) c1=(f01,f11,f21) c2=(f02,f12,f22)
      // cofactor columns: k0 = c1 x c2, k1 = c2 x c0, k2 = c0 x c1
      const k0x = f11 * f22 - f21 * f12, k0y = f21 * f02 - f01 * f22, k0z = f01 * f12 - f11 * f02;
      const k1x = f12 * f20 - f22 * f10, k1y = f22 * f00 - f02 * f20, k1z = f02 * f10 - f12 * f00;
      const k2x = f10 * f21 - f20 * f11, k2y = f20 * f01 - f00 * f21, k2z = f00 * f11 - f10 * f01;
      const J = f00 * k0x + f10 * k0y + f20 * k0z;
      const gamma = 1 + mu / lamT + tPr[t];
      C = J - gamma;
      {
        const g1x = k0x * b00 + k1x * b01 + k2x * b02, g1y = k0y * b00 + k1y * b01 + k2y * b02, g1z = k0z * b00 + k1z * b01 + k2z * b02;
        const g2x = k0x * b10 + k1x * b11 + k2x * b12, g2y = k0y * b10 + k1y * b11 + k2y * b12, g2z = k0z * b10 + k1z * b11 + k2z * b12;
        const g3x = k0x * b20 + k1x * b21 + k2x * b22, g3y = k0y * b20 + k1y * b21 + k2y * b22, g3z = k0z * b20 + k1z * b21 + k2z * b22;
        const g0x = -g1x - g2x - g3x, g0y = -g1y - g2y - g3y, g0z = -g1z - g2z - g3z;
        // compression barrier: below ~1/3 volume the tet resists ever harder
        let alpha = ih2 / (lamT * V);
        if (J < 0.35) {
          const q = Math.max(J / 0.35, 0.25);
          alpha *= q * q;
        }
        const hard = w0 * (g0x * g0x + g0y * g0y + g0z * g0z) + w1 * (g1x * g1x + g1y * g1y + g1z * g1z) +
          w2 * (g2x * g2x + g2y * g2y + g2z * g2z) + w3 * (g3x * g3x + g3y * g3y + g3z * g3z);
        // (nor its volume past hard: a sliver's overshot, back and forth)
        alpha = Math.max(alpha, VOL_SOFT * hard);
        const den = hard + alpha;
        if (den > 1e-12) {
          const dl = -C / den;
          let s = w0 * dl; x[i0] += g0x * s; x[i0 + 1] += g0y * s; x[i0 + 2] += g0z * s;
          s = w1 * dl; x[i1] += g1x * s; x[i1 + 1] += g1y * s; x[i1 + 2] += g1z * s;
          s = w2 * dl; x[i2] += g2x * s; x[i2 + 1] += g2y * s; x[i2 + 2] += g2z * s;
          s = w3 * dl; x[i3] += g3x * s; x[i3 + 1] += g3y * s; x[i3 + 2] += g3z * s;
        }
      }
    }
  }

  // A hollow cube's hollow, sealed - its liquid and the air over it shut in: its volume held (an air-filled
  // balloon's, its liquid's, neither going anywhere), so a part-full or empty one stands as it was made; cut
  // into, it's let be - its walls stand on what they're made of, and what's in it runs out (see Spill). cav[k]:
  // { v: its vertices, f: its faces (as indices into v, wound out of the jelly - into the hollow), V0: its
  // volume, sealed } - see setCavity.
  _solveCavities(h) {
    const x = this.x, w = this.w, aw = this._awake, vp = this.vPiece;
    for (let k = 0; k < MAX_CUBES; k++) {
      const c = this.cav[k];
      if (!c || !c.sealed) continue;
      const V = c.v, F = c.f, G = c.g;
      // (not when all of it's asleep: nothing's moved)
      let awake = false;
      for (let n = 0; n < V.length && !awake; n += 7) if (aw[vp[V[n]]]) awake = true;
      if (!awake) continue;
      // its volume now, and its gradient (the hollow's - the faces wound into it: minus theirs)
      let vol = 0;
      G.fill(0);
      for (let n = 0; n < F.length; n += 3) {
        const a = V[F[n]] * 3, b = V[F[n + 1]] * 3, cc = V[F[n + 2]] * 3;
        const ax = x[a], ay = x[a + 1], az = x[a + 2], bx = x[b], by = x[b + 1], bz = x[b + 2], cx = x[cc], cy = x[cc + 1], cz = x[cc + 2];
        vol -= (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
        const ga = F[n] * 3, gb = F[n + 1] * 3, gc = F[n + 2] * 3;
        G[ga] -= (by * cz - bz * cy) / 6; G[ga + 1] -= (bz * cx - bx * cz) / 6; G[ga + 2] -= (bx * cy - by * cx) / 6;
        G[gb] -= (cy * az - cz * ay) / 6; G[gb + 1] -= (cz * ax - cx * az) / 6; G[gb + 2] -= (cx * ay - cy * ax) / 6;
        G[gc] -= (ay * bz - az * by) / 6; G[gc + 1] -= (az * bx - ax * bz) / 6; G[gc + 2] -= (ax * by - ay * bx) / 6;
      }
      // (held - a little give, and no more than a share of it put right a substep: a squeeze shouldn't kick)
      const C = Math.max(-0.02 * c.V0, Math.min(0.02 * c.V0, vol - c.V0));
      let den = 0;
      for (let n = 0; n < V.length; n++) {
        const o = n * 3;
        den += w[V[n]] * (G[o] * G[o] + G[o + 1] * G[o + 1] + G[o + 2] * G[o + 2]);
      }
      if (!(den > 1e-18)) continue;
      const dl = -C / (den + 1e-7 / (h * h));
      for (let n = 0; n < V.length; n++) {
        const i = V[n], wi = w[i];
        if (!wi) continue;
        const o = n * 3, q = i * 3;
        x[q] += wi * dl * G[o]; x[q + 1] += wi * dl * G[o + 1]; x[q + 2] += wi * dl * G[o + 2];
      }
    }
  }

  // Cube k's hollow (see _solveCavities): its faces - vertex triples, wound out of the jelly - and how much it
  // held when made (V0; or null, keep what it had); sealed or not. Null: none.
  setCavity(k, tri, V0, sealed) {
    if (!tri) {
      this.cav[k] = null;
      return;
    }
    const map = new Map(), V = [], F = new Int32Array(tri.length);
    for (let n = 0; n < tri.length; n++) {
      const i = tri[n];
      let j = map.get(i);
      if (j === undefined) map.set(i, (j = V.length)), V.push(i);
      F[n] = j;
    }
    const prev = this.cav[k];
    this.cav[k] = { v: Int32Array.from(V), f: F, g: new Float64Array(V.length * 3), V0: V0 ?? prev?.V0 ?? 0, sealed };
  }

  // A cut part way through a cube full of liquid sticks to itself: each vertex and its partner across the cut
  // (slitOf) are pulled back to within STITCH_SLACK of their rest gap, over STITCH_T - softly: a hand pulls
  // them apart easily, and let go they close up again. (Unheld, its liquid inside slumped and the cut gaped
  // wider and wider - a slice in from its side, 40 cm in 3 s, pouring; a solid one's stays at a centimetre.)
  // Torn through - its sides in two pieces - they're let be.
  _solveStitches(h) {
    if (this._stTopo !== this.topoVersion) {
      this._stTopo = this.topoVersion;
      const so = this.slitOf, liq = this.cLiq, vc = this.vCube;
      let n = 0;
      for (let i = 0; i < this.nV; i++) {
        const p = so[i] - 1;
        if (p <= i || !this.alive[i] || !this.alive[p] || !liq[vc[i]]) continue;
        if (n + 2 > this._stitch.length) {
          const a = new Int32Array(this._stitch.length * 2);
          a.set(this._stitch);
          this._stitch = a;
        }
        this._stitch[n++] = i;
        this._stitch[n++] = p;
      }
      this._stN = n;
    }
    const n = this._stN;
    if (!n) return;
    const S = this._stitch, x = this.x, X = this.X, w = this.w, vp = this.vPiece, aw = this._awake, vc = this.vCube, CP = this.cPress;
    const beta = 1 - Math.exp(-h / STITCH_T);
    for (let k = 0; k < n; k += 2) {
      const i = S[k], p = S[k + 1], pc = vp[i];
      if (pc < 0 || vp[p] !== pc || !aw[pc]) continue;
      const wi = w[i], wp = w[p], ws = wi + wp;
      if (!(ws > 0)) continue;
      const a = i * 3, b = p * 3;
      const dx = x[b] - x[a], dy = x[b + 1] - x[a + 1], dz = x[b + 2] - x[a + 2], d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const rx = X[b] - X[a], ry = X[b + 1] - X[a + 1], rz = X[b + 2] - X[a + 2], rl = Math.sqrt(rx * rx + ry * ry + rz * rz), pr = CP[vc[i]];
      // (its liquid squeezed: its lips pushed apart, across the cut - its kerf's way - as far as it's squeezed,
      // and let gape that far: a slit squeezed shut let nothing out however hard it was squeezed)
      if (pr > 0 && rl > 1e-7) {
        const nx = rx / rl, ny = ry / rl, nz = rz / rl, sep = dx * nx + dy * ny + dz * nz, want = rl + STITCH_OPEN * pr;
        if (sep < want) {
          const f = (beta * (want - sep)) / ws;
          x[a] -= nx * f * wi; x[a + 1] -= ny * f * wi; x[a + 2] -= nz * f * wi;
          x[b] += nx * f * wp; x[b + 1] += ny * f * wp; x[b + 2] += nz * f * wp;
          continue;
        }
      }
      const C = d - rl - STITCH_SLACK - STITCH_OPEN * pr;
      if (!(C > 0)) continue;
      const f = (beta * C) / (d * ws);
      x[a] += dx * f * wi; x[a + 1] += dy * f * wi; x[a + 2] += dz * f * wi;
      x[b] -= dx * f * wp; x[b + 1] -= dy * f * wp; x[b + 2] -= dz * f * wp;
    }
  }

  _solveGrab(g, h) {
    const { x, px, w } = this;
    const ih2 = 1 / (h * h);
    // pressing hard into another piece: slow the pull down so contact can
    // shove that piece along instead of the grabbed core ploughing into it
    const press = (this._pressP && this._pressP[g.piece]) || 0;
    const ease = Math.max(0.08, 1 - Math.max(0, press - 0.006) / 0.02);
    // (firmer jelly pulls the held patch back harder before the next pull:
    // a longer reach keeps it with the hand)
    const gk = this.p.grabK;
    const maxStep = 0.012 * gk * this.p.size * ease * (1 + Math.min(2, Math.max(0, (this.p.mu - 100) / 70))) * (g.boost || 1);
    for (let j = 0; j < g.n; j++) {
      const i = g.idx[j];
      const wi = w[i];
      if (wi === 0) continue;
      const o = i * 3;
      const tx = g.tx + g.off[j * 3], ty = g.ty + g.off[j * 3 + 1], tz = g.tz + g.off[j * 3 + 2];
      const alpha = (g.compliance / (g.wt[j] * gk)) * ih2;
      const k = (wi / (wi + alpha)) * ease;
      x[o] += (tx - x[o]) * k;
      x[o + 1] += (ty - x[o + 1]) * k;
      x[o + 2] += (tz - x[o + 2]) * k;
      // drags can't outrun contact: cap how far a held vertex moves per substep
      const dx = x[o] - px[o], dy = x[o + 1] - px[o + 1], dz = x[o + 2] - px[o + 2];
      const dl = Math.hypot(dx, dy, dz);
      if (dl > maxStep) {
        const s = maxStep / dl;
        x[o] = px[o] + dx * s;
        x[o + 1] = px[o + 1] + dy * s;
        x[o + 2] = px[o + 2] + dz * s;
      }
    }
  }

  // A round flat face (the mallet head) travelling along d from s0 to s1
  // over this frame: jelly it passes is carried along on the face, a softer
  // rim around it drags the surface down into a bowl. Pusher:
  // { c: [x,y,z] contact point, d: unit direction, r, len, s0, s1 }
  _solvePushers(frac) {
    const { x, w } = this;
    const aw = this._awake, vp = this.vPiece;
    for (const P of this.pushers) {
      const s = P.s0 + (P.s1 - P.s0) * frac;
      if (s <= 0) continue;
      const cx = P.c[0], cy = P.c[1], cz = P.c[2], dx = P.d[0], dy = P.d[1], dz = P.d[2];
      const r = P.r, R = r * 1.9, R2 = R * R, back = s - P.len;
      for (let i = 0; i < this.nV; i++) {
        if (w[i] === 0 || !aw[vp[i]]) continue;
        const o = i * 3;
        const ex = x[o] - cx, ey = x[o + 1] - cy, ez = x[o + 2] - cz;
        const al = ex * dx + ey * dy + ez * dz;
        if (al >= s || al < back) continue;
        const qx = ex - al * dx, qy = ey - al * dy, qz = ez - al * dz;
        const q2 = qx * qx + qy * qy + qz * qz;
        if (q2 > R2) continue;
        let k = s - al;
        if (q2 > r * r) {
          // rim: pressed in less the further out
          const u = 1 - (Math.sqrt(q2) - r) / (R - r);
          k *= u * u * 0.6;
        }
        x[o] += dx * k; x[o + 1] += dy * k; x[o + 2] += dz * k;
      }
    }
  }

  _solveAttract(h) {
    const at = this.attract;
    const { x, w } = this;
    const k = 1 - Math.exp(-at.rate * h);
    const tg = at.targets, only = at.cube ?? -1, vc = this.vCube;
    const n = Math.min(this.nV, at.n);
    for (let i = 0; i < n; i++) {
      if (w[i] === 0 || (only >= 0 && vc[i] !== only)) continue;
      const o = i * 3;
      x[o] += (tg[o] - x[o]) * k;
      x[o + 1] += (tg[o + 1] - x[o + 1]) * k;
      x[o + 2] += (tg[o + 2] - x[o + 2]) * k;
    }
  }

  // Embedded rigid segments (nails): keep the distance between two anchors
  // (barycentric points inside tets) fixed.
  _solveEmbeds(h) {
    const { x, T } = this;
    // (a sleeping piece's points don't move: moved anyway, while it sleeps
    // its last-step positions don't, and when it wakes it's flung by the
    // difference - see _wakeNailed)
    const w0 = this.w, aw = this._awake, vp = this.vPiece;
    const w = this._wEmb && this._wEmb.length >= this.nV ? this._wEmb : (this._wEmb = new Float64Array(this.vCap));
    for (const e of this.embeds) {
      for (let s = 0; s < 2; s++) {
        const t = s ? e.b.tet : e.a.tet;
        if (t < 0 || t >= this.nT) continue;
        for (let k = 0; k < 4; k++) {
          const i = T[t * 4 + k];
          w[i] = aw && !aw[vp[i]] ? 0 : w0[i];
        }
      }
    }
    for (const e of this.embeds) {
      const A = e.a, Bn = e.b;
      if (A.tet < 0 || Bn.tet < 0 || A.tet >= this.nT || Bn.tet >= this.nT) continue;
      const ta = A.tet * 4, tb = Bn.tet * 4;
      let ax = 0, ay = 0, az = 0, bx = 0, by = 0, bz = 0;
      let wa = 0, wb = 0;
      for (let k = 0; k < 4; k++) {
        const ia = T[ta + k], ib = T[tb + k];
        const ba = A.b[k], bb = Bn.b[k];
        ax += x[ia * 3] * ba; ay += x[ia * 3 + 1] * ba; az += x[ia * 3 + 2] * ba;
        bx += x[ib * 3] * bb; by += x[ib * 3 + 1] * bb; bz += x[ib * 3 + 2] * bb;
        wa += ba * ba * w[ia];
        wb += bb * bb * w[ib];
      }
      let dx = bx - ax, dy = by - ay, dz = bz - az;
      const L = Math.hypot(dx, dy, dz);
      if (L < 1e-9) continue;
      dx /= L; dy /= L; dz /= L;
      const C = L - e.len;
      // (a pair - a gel gun's blob - is held on by a tether: it pulls, it
      // never pushes - its two ends all but on top of each other, which way
      // to push them apart is noise, and pushed they shook without end)
      if (e.pair && !e.glue && C <= 0) continue;
      const den = wa + wb + (e.compliance || 0) / (h * h);
      if (den <= 0) continue;
      const dl = -C / den;
      for (let k = 0; k < 4; k++) {
        const ia = T[ta + k], ib = T[tb + k];
        const sa = -dl * A.b[k] * w[ia];
        const sb = dl * Bn.b[k] * w[ib];
        x[ia * 3] += dx * sa; x[ia * 3 + 1] += dy * sa; x[ia * 3 + 2] += dz * sa;
        x[ib * 3] += dx * sb; x[ib * 3 + 1] += dy * sb; x[ib * 3 + 2] += dz * sb;
      }
    }
    // (a pair's two ends: how they've moved apart this substep, damped by
    // its damp - a glob held on by jelly settles; it doesn't swing or rock
    // on its nails forever. Only the nails' ends: the glob itself still
    // wobbles like jelly.)
    const px = this.px;
    for (const e of this.embeds) {
      if (!e.pair || !(e.damp > 0)) continue;
      const A = e.a, Bn = e.b;
      if (A.tet < 0 || Bn.tet < 0 || A.tet >= this.nT || Bn.tet >= this.nT) continue;
      const ta = A.tet * 4, tb = Bn.tet * 4;
      let rx = 0, ry = 0, rz = 0, wa = 0, wb = 0;
      for (let k = 0; k < 4; k++) {
        // (a sleeping end hasn't moved: its last-step positions are old)
        const ia = T[ta + k] * 3, ib = T[tb + k] * 3;
        const ba = aw[vp[T[ta + k]]] ? A.b[k] : 0, bb = aw[vp[T[tb + k]]] ? Bn.b[k] : 0;
        rx += (x[ia] - px[ia]) * ba - (x[ib] - px[ib]) * bb;
        ry += (x[ia + 1] - px[ia + 1]) * ba - (x[ib + 1] - px[ib + 1]) * bb;
        rz += (x[ia + 2] - px[ia + 2]) * ba - (x[ib + 2] - px[ib + 2]) * bb;
        wa += A.b[k] * A.b[k] * w[T[ta + k]];
        wb += Bn.b[k] * Bn.b[k] * w[T[tb + k]];
      }
      if (wa + wb <= 0) continue;
      const kd = e.damp / (wa + wb);
      for (let k = 0; k < 4; k++) {
        const ia = T[ta + k], ib = T[tb + k];
        const sa = -kd * A.b[k] * w[ia], sb = kd * Bn.b[k] * w[ib];
        x[ia * 3] += rx * sa; x[ia * 3 + 1] += ry * sa; x[ia * 3 + 2] += rz * sa;
        x[ib * 3] += rx * sb; x[ib * 3 + 1] += ry * sb; x[ib * 3 + 2] += rz * sb;
      }
    }
  }

  // External point force on an anchor (e.g. magnet pulling a nail).
  pushAnchor(a, fx, fy, fz, dt) {
    if (!a || a.tet < 0 || a.tet >= this.nT) return;
    this.wake(this.tPiece[a.tet]);
    const { v, T } = this;
    for (let k = 0; k < 4; k++) {
      const i = T[a.tet * 4 + k];
      const s = a.b[k] * this.w[i] * dt;
      v[i * 3] += fx * s; v[i * 3 + 1] += fy * s; v[i * 3 + 2] += fz * s;
    }
  }

  // Floor, ceiling and arena wall. Contacts are projected here; their
  // friction is applied to the velocities (see _updateVelocities) - doing it
  // on positions after the elastic solve fed energy into resting pieces and
  // kept them rocking forever.
  _solveBounds(h) {
    const { x, w, m, fpen, wpen } = this;
    const R = this.p.arenaRadius, R2 = R * R, box = this.p.box;
    const top = this.p.ceiling;
    const n = this.nV;
    const aw = this._awake, vp = this.vPiece, I = this._imp;
    // (sticky: each vertex that's touched the floor held to it - see STICK_A - by its piece's tack; and that hold
    // added to its weight's for its grip on it, see _updateVelocities: stuck, it doesn't slide either)
    const SK = this.stick, PT = this._pTack, hold1 = STICK_A * h * h;
    for (let i = 0; i < n; i++) {
      if (w[i] === 0 || !aw[vp[i]]) continue;
      const o = i * 3;
      const y = x[o + 1];
      fpen[i] = 0;
      wpen[i] = 0;
      if (y < 0) {
        x[o + 1] = 0;
        fpen[i] = -y;
        const q = vp[i] * 12, J = -y * m[i];
        I[q] += J; I[q + 1] += J * x[o]; I[q + 3] += J * x[o + 2];
        const tk = PT[vp[i]];
        if (tk > 0) (SK[i] = 1), (fpen[i] += tk * hold1);
        else SK[i] = 0;
      } else if (SK[i] > 0) {
        // (stuck, and pulled up off it: put back, as long as its hold holds - giving a little for it, as hard as it's
        // pulled; pulled harder than it holds, or given out, it lets go - peeled off)
        const H = PT[vp[i]] * hold1 * SK[i];
        if (!(y < H)) SK[i] = 0;
        else {
          x[o + 1] = 0;
          fpen[i] = H;
          SK[i] -= (h * PEEL_RATE * y) / H;
          if (SK[i] < 0.05) SK[i] = 0;
        }
      } else if (y > top) x[o + 1] = top;
      // (the glass room: square walls, half its width R out)
      if (box) {
        const ax = Math.abs(x[o]), az = Math.abs(x[o + 2]);
        if (ax > R || az > R) {
          let pen = 0;
          if (ax > R) {
            pen = ax - R;
            x[o] = x[o] > 0 ? R : -R;
          }
          if (az > R) {
            pen = Math.max(pen, az - R);
            x[o + 2] = x[o + 2] > 0 ? R : -R;
          }
          wpen[i] = pen;
          const q = vp[i] * 12 + 4, J = pen * m[i];
          I[q] += J; I[q + 1] += J * x[o]; I[q + 2] += J * x[o + 1]; I[q + 3] += J * x[o + 2];
        }
        continue;
      }
      const r2 = x[o] * x[o] + x[o + 2] * x[o + 2];
      if (r2 > R2) {
        const r = Math.sqrt(r2);
        const s = R / r;
        x[o] *= s;
        x[o + 2] *= s;
        wpen[i] = r - R;
        const q = vp[i] * 12 + 4, J = (r - R) * m[i];
        I[q] += J; I[q + 1] += J * x[o]; I[q + 2] += J * x[o + 1]; I[q + 3] += J * x[o + 2];
      }
    }
  }

  _updateVelocities(h) {
    const { x, px, v, w, fpen, wpen } = this;
    const ih = 1 / h;
    const n = this.nV;
    const vmax = this.p.maxSpeed, vmax2 = vmax * vmax;
    const aw = this._awake, vp = this.vPiece, vc = this.vCube, cf = this.cFric;
    for (let i = 0; i < n; i++) {
      if (w[i] === 0 || !aw[vp[i]]) continue;
      const o = i * 3, mu = cf[vc[i]];
      let vx = (x[o] - px[o]) * ih, vy = (x[o + 1] - px[o + 1]) * ih, vz = (x[o + 2] - px[o + 2]) * ih;
      // Coulomb friction: tangential speed drops by mu x the normal speed
      // the contact took away (sticks when that is enough to stop it)
      if (fpen[i] > 0) {
        const vt = Math.sqrt(vx * vx + vz * vz);
        if (vt > 0) {
          const k = Math.max(0, 1 - (mu * fpen[i] * ih) / vt);
          vx *= k;
          vz *= k;
        }
      }
      if (wpen[i] > 0) {
        let nx, nz;
        if (this.p.box) {
          // (a square wall's normal: the side it's against - both, in a corner)
          const R = this.p.arenaRadius - 1e-6;
          nx = x[o] >= R ? 1 : x[o] <= -R ? -1 : 0;
          nz = x[o + 2] >= R ? 1 : x[o + 2] <= -R ? -1 : 0;
          const l = Math.hypot(nx, nz) || 1;
          nx /= l;
          nz /= l;
        } else {
          const r = Math.sqrt(x[o] * x[o] + x[o + 2] * x[o + 2]) || 1;
          nx = x[o] / r;
          nz = x[o + 2] / r;
        }
        const vn = vx * nx + vz * nz;
        const tx = vx - vn * nx, tz = vz - vn * nz;
        const tl = Math.sqrt(tx * tx + vy * vy + tz * tz);
        if (tl > 0) {
          const k = Math.max(0, 1 - (0.47 * mu * wpen[i] * ih) / tl); // (the wall grips as the floor does: 0.4 at the default Grip)
          vx = vn * nx + tx * k;
          vy *= k;
          vz = vn * nz + tz * k;
        }
      }
      const s2 = vx * vx + vy * vy + vz * vz;
      if (s2 > vmax2) {
        const k = vmax / Math.sqrt(s2);
        vx *= k; vy *= k; vz *= k;
      }
      v[o] = vx; v[o + 1] = vy; v[o + 2] = vz;
    }
  }

  // Damp deviation from rigid motion per piece (keeps throws ballistic).
  _dampPieces(dt) {
    const { x, v, m } = this;
    const dk = dt * (this.dampBoost || 1) * (this.calmT > 0 ? 10 : 1);
    for (const pc of this.pieces) {
      const vs = pc.verts;
      // (its cube's own damping and drag - and one hushed, shaking hard
      // where it sits, see below - damped hard a while)
      // (full of liquid: as long as that sloshes - water a while, glue hardly, near solid not)
      let dmp = this.cLiq[pc.cube] ? 1.5 * Math.pow(8, this.cVisc[pc.cube]) : this.cDamp[pc.cube];
      if (pc.hush > 0) {
        dmp = Math.max(dmp, 14);
        pc.hush -= dt;
      }
      const kd = 1 - Math.exp(-dmp * dk * this.cBoost[pc.cube]), air = Math.exp(-this.cAir[pc.cube] * dt);
      let M = 0, cx = 0, cy = 0, cz = 0, vx = 0, vy = 0, vz = 0;
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let k = 0; k < vs.length; k++) {
        const i = vs[k], o = i * 3, mi = m[i];
        M += mi;
        cx += x[o] * mi; cy += x[o + 1] * mi; cz += x[o + 2] * mi;
        vx += v[o] * mi; vy += v[o + 1] * mi; vz += v[o + 2] * mi;
        if (x[o] < x0) x0 = x[o];
        if (x[o] > x1) x1 = x[o];
        if (x[o + 1] < y0) y0 = x[o + 1];
        if (x[o + 1] > y1) y1 = x[o + 1];
        if (x[o + 2] < z0) z0 = x[o + 2];
        if (x[o + 2] > z1) z1 = x[o + 2];
      }
      if (M <= 0) continue;
      cx /= M; cy /= M; cz /= M; vx /= M; vy /= M; vz /= M;
      pc.com[0] = cx; pc.com[1] = cy; pc.com[2] = cz;
      pc.vel[0] = vx; pc.vel[1] = vy; pc.vel[2] = vz;
      pc.bbox[0] = x0; pc.bbox[1] = y0; pc.bbox[2] = z0; pc.bbox[3] = x1; pc.bbox[4] = y1; pc.bbox[5] = z1;
      // Bounciness: remember the impact speed while a piece squashes against
      // the floor/wall; for a short window after the squash, set its rebound
      // to exactly e x the impact speed (0 = splat, 0.95 = super ball).
      const e = this.cBounce[pc.cube];
      if (e >= 0 && !pc.asleep) {
        // (up off the floor just now, or not: a landing's only one coming down out of the air)
        if (y0 > 0.02) pc.air = 0.25;
        else if (pc.air > 0) pc.air = Math.max(0, pc.air - dt);
        if (e < SPLAT_E) {
          // A splat (next to no bounce): squashed as far as it goes, its bounce taken out of it - see SPLAT_E. (Its
          // middle held still for the window after, as a bouncier one's is held to its rebound, a pudding's squash
          // kept on pushing into the floor all the while, and sprang it up a cube's height after - and its top
          // flopping back down onto its bottom, standing up off its splat, was taken for a landing, and so again)
          // (how fast it came down: the step before it touched too - from 25 m/s, squashed flat and sprung back up
          // within the step it landed in, its middle read 7 coming down)
          const vd = Math.min(vy, pc.lastVy);
          if (y0 < 0.02 && vd < -1.2 && (pc.air > 0 || pc.impY < 0)) (pc.impY = Math.min(pc.impY, vd)), (pc.landAt = this.time);
          if (pc.impY < 0 && vy > -0.25) {
            pc.splatT = SPLAT_T;
            pc.splatK = (1 - e / SPLAT_E) * Math.min(1, -pc.impY / 4);
            pc.splatV = -pc.impY;
            pc.impY = 0;
          }
          // (and up off it no faster than its bounce takes it, or than it oozes back up into shape: faster's a bounce
          // - from that, squashed flat and sprung back within the step, it went up 3 m)
          const cap = Math.max(e * pc.splatV, 0.6);
          if (pc.splatT > 0 && vy > cap) {
            for (let k = 0; k < vs.length; k++) v[vs[k] * 3 + 1] += cap - vy;
            vy = cap;
          }
        } else {
          if (y0 < 0.02 && vy < -1.2 && !pc.rebT) {
            pc.impY = Math.min(pc.impY || 0, vy);
            if (pc.air > 0) pc.landAt = this.time;
          }
          if (pc.impY && !pc.rebT && vy > -0.25) pc.rebT = 0.22;
          if (pc.rebT) {
            const want = -pc.impY * e;
            const dv = want - vy;
            if ((dv > 0 && !pc.boosted) || dv < 0) {
              for (let k = 0; k < vs.length; k++) v[vs[k] * 3 + 1] += dv;
              vy = want;
              if (dv > 0) pc.boosted = true;
            }
            pc.rebT -= dt;
            if (pc.rebT <= 0) {
              pc.rebT = 0;
              pc.impY = 0;
              pc.boosted = false;
            }
          }
        }
        pc.lastVy = pc.vel[1];
        const rc = Math.hypot(cx, cz) || 1;
        const ux = cx / rc, uz = cz / rc;
        const rmax = Math.max(Math.hypot(x0, z0), Math.hypot(x1, z0), Math.hypot(x0, z1), Math.hypot(x1, z1));
        const vr = vx * ux + vz * uz;
        if (rmax > this.p.arenaRadius - 0.03 && vr > 1.2 && !pc.rebR) {
          pc.impR = Math.max(pc.impR || 0, vr);
          pc.impUx = ux;
          pc.impUz = uz;
        }
        if (pc.impR && !pc.rebR && vr < 0.25) pc.rebR = 0.22;
        if (pc.rebR) {
          const want = -pc.impR * e;
          const cur = vx * pc.impUx + vz * pc.impUz;
          const dv = want - cur;
          if ((dv < 0 && !pc.boostedR) || dv > 0) {
            for (let k = 0; k < vs.length; k++) {
              v[vs[k] * 3] += pc.impUx * dv;
              v[vs[k] * 3 + 2] += pc.impUz * dv;
            }
            vx += pc.impUx * dv;
            vz += pc.impUz * dv;
            if (dv < 0) pc.boostedR = true;
          }
          pc.rebR -= dt;
          if (pc.rebR <= 0) {
            pc.rebR = 0;
            pc.impR = 0;
            pc.boostedR = false;
          }
        }
      }
      // angular momentum and inertia
      let Lx = 0, Ly = 0, Lz = 0;
      let Ixx = 0, Iyy = 0, Izz = 0, Ixy = 0, Ixz = 0, Iyz = 0;
      for (let k = 0; k < vs.length; k++) {
        const i = vs[k], o = i * 3, mi = m[i];
        const rx = x[o] - cx, ry = x[o + 1] - cy, rz = x[o + 2] - cz;
        const ux = v[o] - vx, uy = v[o + 1] - vy, uz = v[o + 2] - vz;
        Lx += (ry * uz - rz * uy) * mi;
        Ly += (rz * ux - rx * uz) * mi;
        Lz += (rx * uy - ry * ux) * mi;
        Ixx += (ry * ry + rz * rz) * mi;
        Iyy += (rx * rx + rz * rz) * mi;
        Izz += (rx * rx + ry * ry) * mi;
        Ixy -= rx * ry * mi;
        Ixz -= rx * rz * mi;
        Iyz -= ry * rz * mi;
      }
      // invert inertia (symmetric 3x3)
      const A = Iyy * Izz - Iyz * Iyz, Bc = Ixz * Iyz - Ixy * Izz, Cc = Ixy * Iyz - Ixz * Iyy;
      const det = Ixx * A + Ixy * Bc + Ixz * Cc;
      let wx = 0, wy = 0, wz = 0;
      if (Math.abs(det) > 1e-14) {
        const id = 1 / det;
        const i00 = A * id, i01 = Bc * id, i02 = Cc * id;
        const i11 = (Ixx * Izz - Ixz * Ixz) * id, i12 = (Ixy * Ixz - Ixx * Iyz) * id, i22 = (Ixx * Iyy - Ixy * Ixy) * id;
        wx = i00 * Lx + i01 * Ly + i02 * Lz;
        wy = i01 * Lx + i11 * Ly + i12 * Lz;
        wz = i02 * Lx + i12 * Ly + i22 * Lz;
      }
      pc.omega[0] = wx;
      pc.omega[1] = wy;
      pc.omega[2] = wz;
      if (pc.asleep) {
        pc.vib = 0;
        continue;
      }
      let vmax2 = 0, e2 = 0, nFast = 0;
      for (let k = 0; k < vs.length; k++) {
        const o = vs[k] * 3;
        const s2 = v[o] * v[o] + v[o + 1] * v[o + 1] + v[o + 2] * v[o + 2];
        if (s2 > vmax2) vmax2 = s2;
        if (s2 > 0.09) nFast++;
        e2 += s2 * m[vs[k]];
      }
      const vrms2 = e2 / M;
      // A piece that isn't going anywhere but won't go quiet - a few of its
      // vertices buzzing against a neighbour it rests on - sleeps anyway: its
      // middle still and not turning for 1.5 s while the buzz doesn't die
      // down (its second half as strong as the first; a wobble decays, even
      // a water balloon's, and is left to settle the usual way).
      // One shaking hard where it sits - squeezed between cubes, between a
      // cube and the wall: the jelly and the contact taking turns, for ever
      // (eight cubes in the room, packed as they happened to land, two of
      // them did it at half a metre a second and never slept) - is hushed:
      // damped hard a while, then it goes quiet like any other.
      // (shaking that hard nudges its middle about too: going nowhere is a
      // little looser for it - and never one held, or touched just now)
      let buzzing = false;
      const vrms = Math.sqrt(vrms2), v2 = vx * vx + vy * vy + vz * vz, w2 = wx * wx + wy * wy + wz * wz;
      const still = v2 < 0.03 * 0.03 && w2 < 0.3 * 0.3;
      const stuck = vrms >= 0.15 && v2 < 0.1 * 0.1 && w2 < 0.8 * 0.8 && this.time - pc.touchT > 1 && !this._grabbedP?.[pc.id];
      if ((still && vrms < 0.15) || stuck) {
        if (pc.buzzT < 0.75) pc.buzzA += vrms * dt;
        else pc.buzzB += vrms * dt;
        pc.buzzT += dt;
        if (pc.buzzT > 1.5) {
          const steady = pc.buzzB > 0.85 * pc.buzzA;
          // (hushed; still at it - a corner crumpled, folded over itself
          // where it landed on another, fighting itself for ever - sprung
          // back into shape (see _untangle); still at it after that, it
          // sleeps: a shake that fast is millimetres, and it's going nowhere)
          if (vrms < 0.15 || (steady && pc.hushN >= 2)) buzzing = steady;
          else if (steady) {
            pc.hush = 1;
            if (pc.hushN === 1) pc.untangle = 0.7;
            pc.hushN = (pc.hushN || 0) + 1;
          }
          pc.buzzT = pc.buzzA = pc.buzzB = 0;
        }
      } else {
        pc.buzzT = pc.buzzA = pc.buzzB = 0;
        if (!still) pc.hushN = 0;
      }
      // (still: all but a handful of its vertices - a cube shot to pieces
      // had one sliver's corner buzzing at 1 m/s in a crease for ever, the
      // rest of its 15,000 still, and it never slept)
      // (one held together across a cut - its self-contact and its body
      // trading a little energy back and forth for ever, a ring that ebbs
      // and swells just past still: a cube shot to pieces rang so for many
      // seconds, too uneven for a buzz - left untouched a while, going
      // nowhere, ringing only a little, it sleeps)
      const ringing = (pc.hinge || pc.gap) && this.time - pc.touchT > 2 && v2 < 0.05 * 0.05 && w2 < 0.15 * 0.15 && vrms2 < 0.08 * 0.08;
      // (going nowhere: a pile of thin slices, each lying on the next - the contact between them kept a
      // shiver of a few cm/s in all of them, rocking and creeping back and forth, over the 3.5 below and
      // never steady enough for a buzz - and the pile never slept: 60 ms a frame of physics a minute on.
      // One no part of which - 12 of its vertices, all but the two that moved most (a sliver's corner
      // flapping in a crease) - is more than 1.2 cm from where it was a second ago, two seconds running,
      // shivering under 15 cm/s (past that: hushed, above) and not dying down (a wobble does - a cube
      // wobbling where it landed goes still the usual way), not held or touched just now, sleeps. Not one
      // full of liquid: that sloshes as it likes.)
      pc.nwT += dt;
      pc.nwV += vrms * dt;
      if (pc.nwT >= 1) {
        const S = pc.nwS, nS = Math.min(12, vs.length);
        let d1 = 0, d2 = 0, d3 = 0; // (the three most any moved, squared)
        for (let k = 0; k < nS; k++) {
          const o = vs[Math.floor((k * vs.length) / nS)] * 3;
          const dx = x[o] - S[k * 3], dy = x[o + 1] - S[k * 3 + 1], dz = x[o + 2] - S[k * 3 + 2];
          let q = dx * dx + dy * dy + dz * dz;
          if (q !== q) q = Infinity; // (no second begun yet)
          if (q > d1) { d3 = d2; d2 = d1; d1 = q; } else if (q > d2) { d3 = d2; d2 = q; } else if (q > d3) d3 = q;
          S[k * 3] = x[o]; S[k * 3 + 1] = x[o + 1]; S[k * 3 + 2] = x[o + 2];
        }
        const mv = pc.nwV / pc.nwT, steady = mv >= 0.85 * pc.nwU || mv < 0.035;
        const quiet = (nS > 3 ? d3 : d1) < 0.012 * 0.012 && mv < 0.15 && steady && !this.cLiq[pc.cube] && this.time - pc.touchT > 1 && !this._grabbedP?.[pc.id];
        pc.nwN = quiet ? pc.nwN + 1 : 0;
        pc.nwU = mv;
        pc.nwT = pc.nwV = 0;
      }
      const nowhere = pc.nwN >= 2;
      if (buzzing || ringing || nowhere || (vrms2 < 0.035 * 0.035 && nFast <= Math.max(3, vs.length * 0.004))) {
        pc.sleepT += buzzing || nowhere ? 1 : dt;
        // (debris - a die or smaller - goes quiet sooner: a settling pile
        // is what costs the most)
        if (pc.sleepT > (vs.length < 0.06 * (this.cN[pc.cube] || 1e9) ? 0.35 : 0.6)) {
          this.sleepPiece(pc);
          continue;
        }
      } else pc.sleepT = 0;
      let dev2 = 0;
      // (a splat's jiggle, damped hard - less and less as its hold wears off)
      const kd0 = pc.splatT > 0 ? Math.max(kd, 1 - Math.exp(-SPLAT_D * pc.splatK * (pc.splatT / SPLAT_T) * dk)) : kd;
      if (pc.splatT > 0) pc.splatT = Math.max(0, pc.splatT - dt);
      // (a corner of a sliver a cut left - a tet a hundredth the size of the
      // rest, see _slivers - damped hard: they buzzed at metres a second in
      // a cube shot full of holes, kept the rest of it ringing, and it never
      // went to sleep)
      const SL = this._sliverV, ks = 1 - Math.exp(-28 * dk);
      for (let k = 0; k < vs.length; k++) {
        const i = vs[k], o = i * 3;
        const rx = x[o] - cx, ry = x[o + 1] - cy, rz = x[o + 2] - cz;
        const rvx = vx + wy * rz - wz * ry, rvy = vy + wz * rx - wx * rz, rvz = vz + wx * ry - wy * rx;
        const ux = v[o] - rvx, uy = v[o + 1] - rvy, uz = v[o + 2] - rvz;
        dev2 += m[i] * (ux * ux + uy * uy + uz * uz);
        const kv = SL && SL[i] ? Math.max(kd0, ks) : kd0;
        v[o] = (rvx + (v[o] - rvx) * (1 - kv)) * air;
        v[o + 1] = (rvy + (v[o + 1] - rvy) * (1 - kv)) * air;
        v[o + 2] = (rvz + (v[o + 2] - rvz) * (1 - kv)) * air;
      }
      pc.vib = Math.sqrt(dev2 / M);
    }
  }

  // Temperature -> material: hot softens, cold stiffens. Heat diffuses.
  _updateMaterial(dt) {
    const { temp, T, tMu } = this;
    const nV = this.nV;
    if (this.heatActive || this._heatResidual > 0) {
      // diffusion (Jacobi, one sweep)
      const nbS = this.nbStart, nbL = this.nbList;
      const k = Math.min(1, 1.6 * dt);
      const relax = Math.exp(-dt / 22);
      let maxAbs = 0;
      const nt = this._tmpTemp && this._tmpTemp.length >= nV ? this._tmpTemp : (this._tmpTemp = new Float32Array(this.vCap));
      for (let i = 0; i < nV; i++) {
        const s = nbS[i], e = nbS[i + 1];
        let sum = 0;
        for (let j = s; j < e; j++) sum += temp[nbL[j]];
        const avg = e > s ? sum / (e - s) : temp[i];
        nt[i] = (temp[i] + (avg - temp[i]) * k) * relax;
      }
      for (let i = 0; i < nV; i++) {
        temp[i] = Math.abs(nt[i]) < 1e-3 ? 0 : nt[i];
        const a = Math.abs(temp[i]);
        if (a > maxAbs) maxAbs = a;
      }
      this._heatResidual = maxAbs;
      if (this.heatActive) this.wakeAll();
      this.heatActive = false;
      const NP = this.pieces.length, tp = this.tPiece;
      const pmu = this._pmu && this._pmu.length >= NP ? this._pmu : (this._pmu = new Float64Array(Math.max(NP, 64)));
      pmu.fill(0, 0, NP);
      for (let t = 0; t < this.nT; t++) {
        const o = t * 4;
        const tt = (temp[T[o]] + temp[T[o + 1]] + temp[T[o + 2]] + temp[T[o + 3]]) * 0.25;
        tMu[t] = tt >= 0 ? Math.max(0.035, Math.exp(-3.2 * tt)) : 1 + 14 * Math.min(1, -tt) * Math.min(1, -tt);
        if (tp[t] >= 0) pmu[tp[t]] += Math.log(tMu[t]);
      }
      // a sleeping piece wakes once it has warmed/cooled enough to change
      // its firmness noticeably (thawing alone shouldn't keep it awake)
      for (let k = 0; k < NP; k++) {
        const pc = this.pieces[k];
        const lm = pmu[k] / Math.max(1, pc.tets.length);
        if (!pc.asleep || pc.sleepLogMu === undefined) pc.sleepLogMu = lm;
        else if (Math.abs(lm - pc.sleepLogMu) > 0.2) this.wake(k);
      }
    }
    // glow decays
    const gd = Math.exp(-dt * 1.6);
    for (let i = 0; i < nV; i++) if (this.glow[i] > 0.001) this.glow[i] *= gd;
    else this.glow[i] = 0;
  }

  // ---------------------------------------------------------------- piece contact
  // Broad phase for piece-vs-piece contact, once per frame. Everything is
  // swept over the frame (from x to x + v dt) so fast pieces are caught:
  // pairs of pieces whose swept boxes meet, a spatial hash of their tets'
  // swept boxes (keyed by cell and piece), and per probe (surface vertex or
  // face centre) the other-piece tets its own swept box overlaps.
  _buildCollisionHash() {
    const { x, v, T } = this;
    const nT = this.nT, NP = this.pieces.length, nV = this.nV;
    const fdt = this._hashSpan;
    const NP64 = Math.max(NP, 64);
    const bb = this._pbb && this._pbb.length >= NP * 6 ? this._pbb : (this._pbb = new Float64Array(NP64 * 6));
    const pcs = this._pcs && this._pcs.length >= NP ? this._pcs : (this._pcs = new Float64Array(NP64));
    for (let k = 0; k < NP; k++) {
      bb[k * 6] = bb[k * 6 + 1] = bb[k * 6 + 2] = Infinity;
      bb[k * 6 + 3] = bb[k * 6 + 4] = bb[k * 6 + 5] = -Infinity;
      pcs[k] = 0;
    }
    // Sweeps are relative: each vertex box is swept by how the vertex moves
    // *within its piece* (its velocity minus the piece's mean velocity), and
    // pieces add their velocity difference pair by pair - chunks flying
    // apart together barely sweep at all. D: each vertex's whole move this
    // frame, for the per-candidate test below.
    const sw = this._sweep && this._sweep.length >= nV * 6 ? this._sweep : (this._sweep = new Float32Array(this.vCap * 6));
    const D = this._disp && this._disp.length >= nV * 3 ? this._disp : (this._disp = new Float32Array(this.vCap * 3));
    const P = this.pieces;
    const pV = this._pVel && this._pVel.length >= NP * 3 ? this._pVel : (this._pVel = new Float64Array(NP64 * 3));
    const pM = this._pMass && this._pMass.length >= NP ? this._pMass : (this._pMass = new Float64Array(NP64));
    pV.fill(0, 0, NP * 3);
    pM.fill(0, 0, NP);
    // (fresh: pieces a cut just made have no velocity history)
    for (let i = 0; i < nV; i++) {
      const k = this.vPiece[i];
      if (k < 0 || !this.w[i]) continue;
      const o = i * 3, mi = this.m[i];
      pV[k * 3] += v[o] * mi; pV[k * 3 + 1] += v[o + 1] * mi; pV[k * 3 + 2] += v[o + 2] * mi;
      pM[k] += mi;
    }
    for (let k = 0; k < NP; k++) {
      const im = pM[k] > 0 ? 1 / pM[k] : 0;
      pV[k * 3] *= im; pV[k * 3 + 1] *= im; pV[k * 3 + 2] *= im;
    }
    // a held piece goes where the hand pulls it (up to the per-substep
    // cap); two hands on one piece: the stronger pull for the piece, the
    // other's on its own held vertices
    const lead = this._leadP && this._leadP.length >= NP * 4 ? this._leadP : (this._leadP = new Float64Array(NP64 * 4));
    const vLead = this.grabs.length > 1 ? (this._leadV && this._leadV.length >= nV * 3 ? this._leadV : (this._leadV = new Float32Array(this.vCap * 3))) : null;
    if (vLead) vLead.fill(0, 0, nV * 3);
    lead.fill(0, 0, NP * 4);
    for (const g of this.grabs) {
      let lx = 0, ly = 0, lz = 0;
      for (let j = 0; j < g.n; j++) {
        const o = g.idx[j] * 3;
        lx += g.tx + g.off[j * 3] - x[o];
        ly += g.ty + g.off[j * 3 + 1] - x[o + 1];
        lz += g.tz + g.off[j * 3 + 2] - x[o + 2];
      }
      const l = Math.hypot(lx, ly, lz) / g.n, lm = 0.012 * this.p.size * this.p.substeps;
      const s = l > lm ? lm / l / g.n : 1 / g.n;
      lx *= s; ly *= s; lz *= s;
      const q = g.piece * 4, m = Math.hypot(lx, ly, lz);
      if (g.piece < 0 || g.piece >= NP) continue;
      if (m >= lead[q + 3]) {
        // (the weaker one, if any, goes onto its own vertices)
        if (vLead && lead[q + 3] > 0) {
          for (const g2 of this.grabs) if (g2 !== g && g2.piece === g.piece) for (let j = 0; j < g2.n; j++) { const o = g2.idx[j] * 3; vLead[o] = lead[q] ; vLead[o + 1] = lead[q + 1]; vLead[o + 2] = lead[q + 2]; }
        }
        lead[q] = lx; lead[q + 1] = ly; lead[q + 2] = lz; lead[q + 3] = m;
      } else if (vLead) {
        for (let j = 0; j < g.n; j++) { const o = g.idx[j] * 3; vLead[o] = lx; vLead[o + 1] = ly; vLead[o + 2] = lz; }
      }
    }
    const anyGrab = this.grabs.length > 0;
    for (let i = 0; i < nV; i++) {
      const o = i * 3, r = i * 6;
      const ax = x[o], ay = x[o + 1], az = x[o + 2];
      const kp = Math.max(0, this.vPiece[i]) * 3;
      let ex = v[o] * fdt, ey = v[o + 1] * fdt, ez = v[o + 2] * fdt;
      if (anyGrab && this.vPiece[i] >= 0) {
        const q = this.vPiece[i] * 4;
        if (lead[q + 3] > 0) {
          if (vLead && (vLead[o] || vLead[o + 1] || vLead[o + 2])) {
            ex += vLead[o]; ey += vLead[o + 1]; ez += vLead[o + 2];
          } else {
            ex += lead[q]; ey += lead[q + 1]; ez += lead[q + 2];
          }
        }
      }
      D[o] = ex; D[o + 1] = ey; D[o + 2] = ez;
      const dx = ex - pV[kp] * fdt, dy = ey - pV[kp + 1] * fdt, dz = ez - pV[kp + 2] * fdt;
      const gr = 0.003 + 0.12 * (Math.abs(dx) + Math.abs(dy) + Math.abs(dz));
      sw[r] = (dx < 0 ? ax + dx : ax) - gr;
      sw[r + 1] = (dy < 0 ? ay + dy : ay) - gr;
      sw[r + 2] = (dz < 0 ? az + dz : az) - gr;
      sw[r + 3] = (dx > 0 ? ax + dx : ax) + gr;
      sw[r + 4] = (dy > 0 ? ay + dy : ay) + gr;
      sw[r + 5] = (dz > 0 ? az + dz : az) + gr;
      const k = this.vPiece[i];
      if (k < 0 || !this.w[i]) continue;
      const sl = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) + gr;
      if (sl > pcs[k]) pcs[k] = sl;
      const b = k * 6;
      if (sw[r] < bb[b]) bb[b] = sw[r];
      if (sw[r + 1] < bb[b + 1]) bb[b + 1] = sw[r + 1];
      if (sw[r + 2] < bb[b + 2]) bb[b + 2] = sw[r + 2];
      if (sw[r + 3] > bb[b + 3]) bb[b + 3] = sw[r + 3];
      if (sw[r + 4] > bb[b + 4]) bb[b + 4] = sw[r + 4];
      if (sw[r + 5] > bb[b + 5]) bb[b + 5] = sw[r + 5];
    }
    // hash cells per piece: fine for slow pieces, coarser for fast ones (so a
    // fast tet still lands in only a few cells) - but no coarser than about
    // two of the mesh's: the piece's fastest vertex set it, and a jelly
    // wobbling hard (shot full of holes, soft and bouncy) had a few flying
    // about inside it at 20 m/s - cells half a cube across, every probe
    // looking through thousands of tets, a second a frame. A tet that fast
    // just takes a few more cells.
    for (let k = 0; k < NP; k++) pcs[k] = 1 / (this.hCell * 0.75 + Math.min(pcs[k], this.hCell));
    // pairs whose swept boxes overlap (and aren't both asleep): partner lists
    const act = this._pieceActive && this._pieceActive.length >= NP ? this._pieceActive : (this._pieceActive = new Uint8Array(NP64));
    act.fill(0);
    const ptS = this._ptS && this._ptS.length >= NP + 1 ? this._ptS : (this._ptS = new Int32Array(NP64 + 1));
    const pairs = [];
    const m = 0.006;
    const ghost = this.ghostCube;
    for (let a = 0; a < NP; a++)
      for (let b = a + 1; b < NP; b++) {
        if (P[a].asleep && P[b].asleep) continue;
        // (a cube re-cubing on its own passes through everything)
        if (ghost >= 0 && (P[a].cube === ghost || P[b].cube === ghost)) continue;
        const A = a * 6, B = b * 6;
        // a's box swept by how it moves relative to b this frame
        const rx = (pV[a * 3] - pV[b * 3]) * fdt, ry = (pV[a * 3 + 1] - pV[b * 3 + 1]) * fdt, rz = (pV[a * 3 + 2] - pV[b * 3 + 2]) * fdt;
        const rm = m + 0.12 * (Math.abs(rx) + Math.abs(ry) + Math.abs(rz));
        const ax0 = bb[A] + Math.min(0, rx), ay0 = bb[A + 1] + Math.min(0, ry), az0 = bb[A + 2] + Math.min(0, rz);
        const ax1 = bb[A + 3] + Math.max(0, rx), ay1 = bb[A + 4] + Math.max(0, ry), az1 = bb[A + 5] + Math.max(0, rz);
        if (ax0 - rm > bb[B + 3] || bb[B] - rm > ax1 || ay0 - rm > bb[B + 4] || bb[B + 1] - rm > ay1 || az0 - rm > bb[B + 5] || bb[B + 2] - rm > az1) continue;
        act[a] = act[b] = 1;
        pairs.push(a, b);
      }
    // and each awake piece against itself (see gather): 2 = only that, so
    // only the tets touching its surface need hashing (see _sizeContactScratch)
    const selfOK = this._selfOK && this._selfOK.length >= NP ? this._selfOK : (this._selfOK = new Uint8Array(NP64));
    let anySelf = false;
    // (where it can fold onto itself: a flap on a hinge, or soft jelly -
    // firmer jelly doesn't fold far enough, even dragged by a corner)
    const quiet = this.time < this.selfQuietUntil;
    for (let a = 0; a < NP; a++) {
      const soft = this.cMu[P[a].cube] < 110 || this.cLiq[P[a].cube] > 0;
      // (or anything with a fold in it to pop out - all its tets, as the
      // fold can reach past the layer at the surface)
      const folded = P[a].foldUntil > this.time;
      // (a blast's quiet - see radialImpulse, cavity - is for soft jelly's
      // folds, a cost; one held together across a cut needs it always: a
      // gunshot's quiet, shot after shot, let the top half of a cube shot
      // through sink into the bottom half)
      const needs = P[a].hinge || P[a].gap;
      const can = this.p.selfCollide && (!quiet || needs) && !P[a].asleep && !(P[a].untangle > 0) && P[a].cube !== ghost && (needs || soft || folded), ac = act[a];
      selfOK[a] = can ? (ac || folded ? 1 : 2) : 0;
      anySelf = anySelf || selfOK[a] > 0;
    }
    // (only the surface vertices near another part of their own body - see _selfCheck)
    if (anySelf) anySelf = this._selfCheck(NP);
    this._anyContact = pairs.length > 0 || anySelf;
    if (!this._anyContact) return;
    ptS.fill(0, 0, NP + 1);
    for (let k = 0; k < pairs.length; k++) ptS[pairs[k] + 1]++;
    for (let k = 0; k < NP; k++) ptS[k + 1] += ptS[k];
    const ptL = new Int32Array(pairs.length);
    const ptF = ptS.slice(0, NP);
    for (let k = 0; k < pairs.length; k += 2) {
      ptL[ptF[pairs[k]]++] = pairs[k + 1];
      ptL[ptF[pairs[k + 1]]++] = pairs[k];
    }
    // contact found last substep, per probe (tet, face): usually still right
    if (this._warmVersion !== this.topoVersion || !this._wtV || this._wtV.length < nV) {
      this._wtV = new Int32Array(this.vCap).fill(-1);
      this._wfV = new Int32Array(this.vCap).fill(-1);
      this._wtF = new Int32Array(Math.max(this.nF, 1)).fill(-1);
      this._wfF = new Int32Array(Math.max(this.nF, 1)).fill(-1);
      this._warmVersion = this.topoVersion;
    }
    this._hashTets(ptL);
    this._gatherProbes(ptL);
  }

  // Folds: every so often (and when a piece falls asleep) look for surface
  // vertices that have ended up inside their own body - in a tet more than
  // 2 steps from them in the mesh, so not just pressed into a crease. A
  // drag can push a fold through faster than contact holds it, and firm
  // jelly isn't watched for self-contact at all; anything found is held as
  // folded for a moment: its piece runs self-contact on all its tets, those
  // vertices probe, and they pop back out (see _selfCheck, _contact).
  _foldCheck(dt) {
    const P = this.pieces, NP = P.length;
    if (!this.p.selfCollide || !NP) return;
    this._foldClock += dt;
    let ask = false;
    for (let k = 0; k < NP; k++) if (P[k].foldAsk) ask = true;
    if (this._foldClock < 0.12 && !ask) return;
    this._foldClock = 0;
    // which pieces: any that just fell asleep, then awake ones in turn, up
    // to a budget of tets a look (lots of pieces: a few per look)
    const look = this._foldLook;
    look.fill(0, 0, NP);
    let nLook = 0, budget = 3500;
    // (one whose folds wouldn't come undone, left be till it's next touched)
    const given = (pc) => pc.foldGiveUp >= 0 && pc.foldGiveUp === pc.touchT;
    for (let k = 0; k < NP; k++) {
      if (!P[k].foldAsk) continue;
      P[k].foldAsk = false;
      if (given(P[k])) continue;
      look[k] = 1;
      nLook++;
      budget -= P[k].tets.length;
    }
    for (let n = 0; n < NP && budget > 0; n++) {
      const k = (this._foldNext + n) % NP;
      if (look[k] || P[k].asleep || P[k].tets.length <= 8 || given(P[k])) continue;
      look[k] = 1;
      nLook++;
      budget -= P[k].tets.length;
      this._foldNext = k + 1;
    }
    if (!nLook) return;
    const found = this._foldFound && this._foldFound.length >= NP ? this._foldFound : (this._foldFound = new Uint8Array(Math.max(NP, 64)));
    found.fill(0, 0, NP);
    // (and found deep: in a tet with no corner on its surface - a part sunk
    // into another, never left be; not a seam pressed shut)
    const deep = this._foldDeep && this._foldDeep.length >= NP ? this._foldDeep : (this._foldDeep = new Uint8Array(Math.max(NP, 64)));
    deep.fill(0, 0, NP);
    const E = this.esc;
    const x = this.x, T = this.T, tp = this.tPiece, nT = this.nT;
    // the looked-at pieces' tets in a grid about a tet across (box and cell
    // range per tet)
    const C = 0.9 * this.hCell, iC = 1 / C;
    const box = this._fgBox, cnt = this._fgCount, rng = this._hRanges;
    let total = 0;
    for (let t = 0; t < nT; t++) {
      const r = t * 6;
      if (!look[tp[t]] || this.vol0[t] <= 0) {
        rng[r] = 1; rng[r + 1] = 0; // (none)
        continue;
      }
      const o = t * 4;
      const a = T[o] * 3, b = T[o + 1] * 3, c = T[o + 2] * 3, d = T[o + 3] * 3;
      let v0 = x[a], v1 = x[b], v2 = x[c], v3 = x[d];
      box[r] = Math.min(v0, v1, v2, v3); box[r + 3] = Math.max(v0, v1, v2, v3);
      v0 = x[a + 1]; v1 = x[b + 1]; v2 = x[c + 1]; v3 = x[d + 1];
      box[r + 1] = Math.min(v0, v1, v2, v3); box[r + 4] = Math.max(v0, v1, v2, v3);
      v0 = x[a + 2]; v1 = x[b + 2]; v2 = x[c + 2]; v3 = x[d + 2];
      box[r + 2] = Math.min(v0, v1, v2, v3); box[r + 5] = Math.max(v0, v1, v2, v3);
      rng[r] = Math.floor(box[r] * iC); rng[r + 1] = Math.floor(box[r + 3] * iC);
      rng[r + 2] = Math.floor(box[r + 1] * iC); rng[r + 3] = Math.floor(box[r + 4] * iC);
      rng[r + 4] = Math.floor(box[r + 2] * iC); rng[r + 5] = Math.floor(box[r + 5] * iC);
      total += (rng[r + 1] - rng[r] + 1) * (rng[r + 3] - rng[r + 2] + 1) * (rng[r + 5] - rng[r + 4] + 1);
    }
    let size = 1024;
    while (size < total * 2 && size < 1 << 14) size <<= 1;
    const mask = size - 1;
    cnt.fill(0, 0, size + 1);
    for (let t = 0; t < nT; t++) {
      const r = t * 6;
      for (let ix = rng[r]; ix <= rng[r + 1]; ix++)
        for (let iy = rng[r + 2]; iy <= rng[r + 3]; iy++)
          for (let iz = rng[r + 4]; iz <= rng[r + 5]; iz++) cnt[((Math.imul(ix, 92837111) ^ Math.imul(iy, 689287499) ^ Math.imul(iz, 283923481)) & mask) + 1]++;
    }
    for (let k = 0; k < size; k++) cnt[k + 1] += cnt[k];
    const ent = this._fgEnt.length >= total ? this._fgEnt : (this._fgEnt = new Int32Array(total * 2));
    const fill = this._svFill.length >= size ? this._svFill : (this._svFill = new Int32Array(size));
    fill.set(cnt.subarray(0, size));
    for (let t = 0; t < nT; t++) {
      const r = t * 6;
      for (let ix = rng[r]; ix <= rng[r + 1]; ix++)
        for (let iy = rng[r + 2]; iy <= rng[r + 3]; iy++)
          for (let iz = rng[r + 4]; iz <= rng[r + 5]; iz++) ent[fill[(Math.imul(ix, 92837111) ^ Math.imul(iy, 689287499) ^ Math.imul(iz, 283923481)) & mask]++] = t;
    }
    // every surface vertex of those pieces against its own tets: well inside
    // one (not on its skin) that isn't within 2 steps of it in the mesh
    const sv = this._surfV, nSV = this._nSurfV, vp = this.vPiece, hood = this._hood;
    const nbS = this.nbStart, nbL = this.nbList, foldU = this._foldUntil, ct = this._ct;
    const hold = this.time + 0.6, X = this.X, near2 = (1.1 * this.hCell) ** 2;
    let hs = this._hoodStamp;
    for (let q = 0; q < nSV; q++) {
      const i = sv[q], k = vp[i];
      if (k < 0 || !look[k]) continue;
      const px = x[i * 3], py = x[i * 3 + 1], pz = x[i * 3 + 2];
      const h = (Math.imul(Math.floor(px * iC), 92837111) ^ Math.imul(Math.floor(py * iC), 689287499) ^ Math.imul(Math.floor(pz * iC), 283923481)) & mask;
      let stamped = false;
      for (let e = cnt[h]; e < cnt[h + 1]; e++) {
        const t = ent[e];
        if (tp[t] !== k) continue;
        const r = t * 6;
        if (px < box[r] || px > box[r + 3] || py < box[r + 1] || py > box[r + 4] || pz < box[r + 2] || pz > box[r + 5]) continue;
        const o = t * 4;
        if (T[o] === i || T[o + 1] === i || T[o + 2] === i || T[o + 3] === i) continue;
        if (!(this._tetGap(t, px, py, pz) < 0) || Math.min(ct.b0, ct.b1, ct.b2, ct.b3) <= 0.02) continue;
        // (inside one: is it a neighbour's? its 2 steps, stamped the first time)
        if (!stamped) {
          stamped = true;
          hs++;
          hood[i] = hs;
          for (let e1 = nbS[i]; e1 < nbS[i + 1]; e1++) {
            const u = nbL[e1];
            hood[u] = hs;
            for (let e2 = nbS[u]; e2 < nbS[u + 1]; e2++) hood[nbL[e2]] = hs;
          }
        }
        if (hood[T[o]] === hs || hood[T[o + 1]] === hs || hood[T[o + 2]] === hs || hood[T[o + 3]] === hs) continue;
        // (nor one from just across a cut - the face it was cut from, where it
        // lay at rest: the cut's two faces pressed together read as folded, and
        // pushing them apart against the body pulling them back rocked a
        // part-cut firm cube for ever)
        let across = false;
        for (let j = 0; j < 4 && !across; j++) {
          const u = T[o + j] * 3, dx = X[u] - X[i * 3], dy = X[u + 1] - X[i * 3 + 1], dz = X[u + 2] - X[i * 3 + 2];
          across = dx * dx + dy * dy + dz * dz < near2;
        }
        if (across) continue;
        foldU[i] = hold;
        P[k].foldUntil = hold;
        found[k] = 1;
        let inner = !!E;
        for (let j = 0; j < 4 && inner; j++) {
          const u = T[o + j] * 3;
          if (E[u] * E[u] + E[u + 1] * E[u + 1] + E[u + 2] * E[u + 2] < 1e-10) inner = false;
        }
        if (inner) deep[k] = 1;
        if (P[k].asleep && (inner || P[k].foldN < FOLD_GIVE_UP - 1)) this.wake(k);
        break;
      }
    }
    this._hoodStamp = hs;
    // Folds found look after look in a piece nobody's touched meanwhile -
    // a cube shot to pieces had 200 of its vertices pressed into the other
    // side of a seam, found folded again every look, for ever: its whole
    // body probing itself, and woken the moment it fell asleep - are given
    // up on: let go, and the piece not looked at again till it's touched.
    for (let k = 0; k < NP; k++) {
      if (!look[k]) continue;
      const pc = P[k];
      if (!found[k] || deep[k]) {
        pc.foldN = 0;
        continue;
      }
      pc.foldN = pc.foldTouch === pc.touchT ? pc.foldN + 1 : 1;
      pc.foldTouch = pc.touchT;
      if (pc.foldN < FOLD_GIVE_UP) continue;
      pc.foldGiveUp = pc.touchT;
      pc.foldUntil = 0;
      for (const i of pc.verts) foldU[i] = 0;
    }
  }

  // Every 0.25 s, a look at awake pieces held or blasted in the last 4 s but
  // not held now (round-robin, a budget of tets a look) for surfaces passed
  // through themselves; found
  // twice in a row - not just a moment of a fold coming undone - the piece
  // springs back out of it (see _untangle).
  _tangleCheck(dt) {
    const P = this.pieces, NP = P.length;
    if (!this.p.selfCollide || !NP) return;
    this._tangleClock += dt;
    if (this._tangleClock < 0.25) return;
    this._tangleClock = 0;
    const look = this._tgLook && this._tgLook.length >= NP ? this._tgLook : (this._tgLook = new Uint8Array(Math.max(NP, 64)));
    const out = this._tgOut && this._tgOut.length >= NP ? this._tgOut : (this._tgOut = new Int32Array(Math.max(NP, 64)));
    look.fill(0, 0, NP);
    out.fill(0, 0, NP);
    const GP = this.grabs.length ? this._grabbedP : null;
    let budget = 9000, any = false;
    for (let n = 0; n < NP && budget > 0; n++) {
      const k = (this._tangleNext + n) % NP, pc = P[k];
      // (not a piece still joined across a cut - a flap on its hinge: the cut's
      // two faces lie against each other and read as passing through, and its
      // rest shape is the whole cube - springing back closed the cut, the
      // halves fell open again, and round it went: the "twerk")
      // (nor one squashed by a landing, or by the air as it falls - see LAND_CALM)
      if (pc.asleep || pc.hinge || (GP && GP[k]) || pc.untangle > 0 || pc.verts.length < 30 || this.time - pc.touchT > 4) continue;
      if (this.cWind[pc.cube] > 0 || this.time - pc.landAt < LAND_CALM) continue;
      // (a tangle three springings back haven't undone - a fold stuck fast -
      // is left be till the piece is next touched: trying for ever kept it
      // awake, pulled about, for ever)
      if (pc.tangleTouch !== pc.touchT) {
        pc.tangleTouch = pc.touchT;
        pc.tangleTries = 0;
      }
      if (pc.tangleTries >= 3) continue;
      look[k] = 1;
      any = true;
      budget -= pc.tets.length;
      this._tangleNext = k + 1;
    }
    if (!any) return;
    this._tangleCount(look, out);
    for (let k = 0; k < NP; k++) {
      if (!look[k]) continue;
      const pc = P[k];
      if (!out[k]) pc.tangleN = 0;
      else if (++pc.tangleN >= 2) {
        pc.tangleN = 0;
        pc.untangle = 0.7;
        pc.tangleTries++;
      }
    }
  }

  // A cube full of liquid, its shell thin (Skin under medium) and firm: how much more its shell's held to its shape
  // (0..1) - all of it, ultrathin rubber, less as it's softer (the square of how far up Firmness it is) or thicker,
  // none from a medium skin up or at pudding. (One tet thick, its tets no harder than a substep can hold, it sagged
  // like a water balloon at any firmness: ultrathin rubber 93% of its height, its sides out 5%.)
  _shellFirm(k) {
    if (!this.cLiq[k] || !this.cHollow[k]) return 0;
    const thin = 1 - Math.min(1, Math.max(0, this.cSkin[k]) / 0.5);
    if (!(thin > 0)) return 0;
    const f = Math.min(1, Math.max(0, Math.log(this.cMu[k] / 45) / Math.log(1000 / 45)));
    return f * f * thin;
  }

  // ...held so: each of its pieces sprung toward its shape as made, turned and placed as it is now - a force, so
  // it wobbles on, a rubber one quicker (pulled there - as Rigidity does - it stood, but its wobble died: a poke's
  // swing 14% of its size to 4). Ultrathin rubber now 97.5% of its height, its sides out 3%, as a medium skin
  // stands - a poke's swing 7%, still swinging a second on.
  _shellSpring(h) {
    const KS = this._ssK || (this._ssK = new Float64Array(MAX_CUBES));
    let any = false;
    for (let k = 0; k < MAX_CUBES; k++) {
      const s = this._shellFirm(k), F = SHELL_HZ * Math.sqrt(s);
      KS[k] = s > 0 ? 4 * Math.PI * Math.PI * F * F * h : 0;
      if (KS[k] > 0) any = true;
    }
    if (!any) return;
    const P = this.pieces, x = this.x, X = this.X, v = this.v, m = this.m, w = this.w, aw = this._awake;
    const A = this._ssA || (this._ssA = new Float64Array(9)), R = this._ssR || (this._ssR = new Float64Array(9));
    let held = null;
    if (this.grabs.length) {
      held = this._rgHeld && this._rgHeld.length >= this.nV ? this._rgHeld : (this._rgHeld = new Uint8Array(this.vCap));
      held.fill(0, 0, this.nV);
      for (const g of this.grabs) for (let j = 0; j < g.n; j++) held[g.idx[j]] = 1;
    }
    for (let k = 0; k < P.length; k++) {
      const pc = P[k], kh = KS[pc.cube];
      if (!aw[k] || pc.untangle > 0 || !(kh > 0)) continue;
      const vs = pc.verts;
      let M = 0, Cx = 0, Cy = 0, Cz = 0, cx = 0, cy = 0, cz = 0;
      for (let n = 0; n < vs.length; n++) {
        const i = vs[n], o = i * 3, mi = m[i];
        M += mi;
        Cx += X[o] * mi; Cy += X[o + 1] * mi; Cz += X[o + 2] * mi;
        cx += x[o] * mi; cy += x[o + 1] * mi; cz += x[o + 2] * mi;
      }
      if (!(M > 0)) continue;
      Cx /= M; Cy /= M; Cz /= M; cx /= M; cy /= M; cz /= M;
      A.fill(0);
      for (let n = 0; n < vs.length; n++) {
        const i = vs[n], o = i * 3, mi = m[i];
        const dx = (x[o] - cx) * mi, dy = (x[o + 1] - cy) * mi, dz = (x[o + 2] - cz) * mi;
        const rx = X[o] - Cx, ry = X[o + 1] - Cy, rz = X[o + 2] - Cz;
        A[0] += dx * rx; A[1] += dx * ry; A[2] += dx * rz;
        A[3] += dy * rx; A[4] += dy * ry; A[5] += dy * rz;
        A[6] += dz * rx; A[7] += dz * ry; A[8] += dz * rz;
      }
      polarRot(pc.ssQ || (pc.ssQ = new Float64Array([0, 0, 0, 1])), A, R, 4);
      for (let n = 0; n < vs.length; n++) {
        const i = vs[n];
        if (w[i] === 0 || (held && held[i])) continue;
        const o = i * 3, rx = X[o] - Cx, ry = X[o + 1] - Cy, rz = X[o + 2] - Cz;
        v[o] += kh * (cx + R[0] * rx + R[1] * ry + R[2] * rz - x[o]);
        v[o + 1] += kh * (cy + R[3] * rx + R[4] * ry + R[5] * rz - x[o + 1]);
        v[o + 2] += kh * (cz + R[6] * rx + R[7] * ry + R[8] * rz - x[o + 2]);
      }
    }
  }

  // Rigidity (p.rigidity, 0..1): each moving piece pulled toward its rest
  // shape, turned and placed as the piece is now (shape matching, Muller et
  // al. 2005; the turn by polarRot, warm from the last substep). What the
  // tets alone can't be made to hold at a stable time step: stiff, dead,
  // near-rigid bodies. A time constant, not a per-substep share, so it feels
  // the same at any substep count: 0.5 s at 0 (off) down to 0.5 ms at 1.
  // Vertices a hand holds aren't pulled back (else a stiff piece fought the
  // hand every substep) - nor ones with no mass (w = 0).
  _solveRigidity(h) {
    // (each cube its own: an amount a substep per cube)
    const AMT = this._rgAmt || (this._rgAmt = new Float64Array(MAX_CUBES));
    for (let k = 0; k < MAX_CUBES; k++) {
      const r = this.cRigid[k];
      AMT[k] = r > 0 ? 1 - Math.exp(-h / (0.5 * Math.pow(10, -3 * r))) : 0;
    }
    const P = this.pieces, x = this.x, X = this.X, m = this.m, w = this.w, aw = this._awake;
    const A = this._rgA || (this._rgA = new Float64Array(9)), R = this._rgR || (this._rgR = new Float64Array(9));
    let held = null;
    if (this.grabs.length) {
      held = this._rgHeld && this._rgHeld.length >= this.nV ? this._rgHeld : (this._rgHeld = new Uint8Array(this.vCap));
      held.fill(0, 0, this.nV);
      for (const g of this.grabs) for (let j = 0; j < g.n; j++) held[g.idx[j]] = 1;
    }
    for (let k = 0; k < P.length; k++) {
      const pc = P[k], amt = AMT[pc.cube];
      if (!aw[k] || pc.untangle > 0 || !(amt > 1e-4)) continue;
      const vs = pc.verts;
      let M = 0, Cx = 0, Cy = 0, Cz = 0, cx = 0, cy = 0, cz = 0;
      for (let n = 0; n < vs.length; n++) {
        const i = vs[n], o = i * 3, mi = m[i];
        M += mi;
        Cx += X[o] * mi; Cy += X[o + 1] * mi; Cz += X[o + 2] * mi;
        cx += x[o] * mi; cy += x[o + 1] * mi; cz += x[o + 2] * mi;
      }
      if (!(M > 0)) continue;
      Cx /= M; Cy /= M; Cz /= M; cx /= M; cy /= M; cz /= M;
      A.fill(0);
      for (let n = 0; n < vs.length; n++) {
        const i = vs[n], o = i * 3, mi = m[i];
        const dx = (x[o] - cx) * mi, dy = (x[o + 1] - cy) * mi, dz = (x[o + 2] - cz) * mi;
        const rx = X[o] - Cx, ry = X[o + 1] - Cy, rz = X[o + 2] - Cz;
        A[0] += dx * rx; A[1] += dx * ry; A[2] += dx * rz;
        A[3] += dy * rx; A[4] += dy * ry; A[5] += dy * rz;
        A[6] += dz * rx; A[7] += dz * ry; A[8] += dz * rz;
      }
      polarRot(pc.rigQ, A, R, 4);
      for (let n = 0; n < vs.length; n++) {
        const i = vs[n];
        if (w[i] === 0 || (held && held[i])) continue;
        const o = i * 3, rx = X[o] - Cx, ry = X[o + 1] - Cy, rz = X[o + 2] - Cz;
        x[o] += amt * (cx + R[0] * rx + R[1] * ry + R[2] * rz - x[o]);
        x[o + 1] += amt * (cy + R[3] * rx + R[4] * ry + R[5] * rz - x[o + 1]);
        x[o + 2] += amt * (cz + R[6] * rx + R[7] * ry + R[8] * rz - x[o + 2]);
      }
    }
  }

  // A piece passed through itself springs back to its rest shape - turned
  // and sized to fit how it lies now, on the floor - a share each frame for
  // 0.7 s, its self-contact off meanwhile so the surfaces can slip back
  // through each other. (Its rest shape has nothing passed through; self-
  // contact would only hold the tangle in place, and pulling it apart from
  // the inside made it worse.)
  _untangle(dt) {
    const P = this.pieces, x = this.x, X = this.X, v = this.v, m = this.m;
    for (let k = 0; k < P.length; k++) {
      const pc = P[k];
      if (!(pc.untangle > 0)) continue;
      if (this.grabs.length && this._grabbedP && this._grabbedP[k]) {
        pc.untangle = 0;
        continue;
      }
      pc.untangle -= dt;
      if (pc.asleep) this.wake(k);
      const vs = pc.verts;
      let M = 0, Cx = 0, Cy = 0, Cz = 0, cx = 0, cy = 0, cz = 0, ux = 0, uy = 0, uz = 0;
      for (let n = 0; n < vs.length; n++) {
        const i = vs[n], o = i * 3, w = m[i];
        M += w;
        Cx += X[o] * w; Cy += X[o + 1] * w; Cz += X[o + 2] * w;
        cx += x[o] * w; cy += x[o + 1] * w; cz += x[o + 2] * w;
        ux += v[o] * w; uy += v[o + 1] * w; uz += v[o + 2] * w;
      }
      if (M <= 0) continue;
      Cx /= M; Cy /= M; Cz /= M; cx /= M; cy /= M; cz /= M; ux /= M; uy /= M; uz /= M;
      // A = sum m (x - c)(X - C)^T, columns a0 a1 a2
      let a00 = 0, a01 = 0, a02 = 0, a10 = 0, a11 = 0, a12 = 0, a20 = 0, a21 = 0, a22 = 0, den = 0;
      for (let n = 0; n < vs.length; n++) {
        const i = vs[n], o = i * 3, w = m[i];
        const dx = (x[o] - cx) * w, dy = (x[o + 1] - cy) * w, dz = (x[o + 2] - cz) * w;
        const rx = X[o] - Cx, ry = X[o + 1] - Cy, rz = X[o + 2] - Cz;
        a00 += dx * rx; a10 += dy * rx; a20 += dz * rx;
        a01 += dx * ry; a11 += dy * ry; a21 += dz * ry;
        a02 += dx * rz; a12 += dy * rz; a22 += dz * rz;
        den += w * (rx * rx + ry * ry + rz * rz);
      }
      if (den <= 0) continue;
      // its rotation (Muller et al. 2016: iterate q toward the polar part of A)
      const q = pc.fitQ;
      let r00 = 1, r01 = 0, r02 = 0, r10 = 0, r11 = 1, r12 = 0, r20 = 0, r21 = 0, r22 = 1;
      for (let it = 0; it < 20; it++) {
        const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
        r00 = 1 - 2 * (qy * qy + qz * qz); r01 = 2 * (qx * qy - qz * qw); r02 = 2 * (qx * qz + qy * qw);
        r10 = 2 * (qx * qy + qz * qw); r11 = 1 - 2 * (qx * qx + qz * qz); r12 = 2 * (qy * qz - qx * qw);
        r20 = 2 * (qx * qz - qy * qw); r21 = 2 * (qy * qz + qx * qw); r22 = 1 - 2 * (qx * qx + qy * qy);
        // omega = sum_j col_j(R) x col_j(A) / |sum_j col_j(R) . col_j(A)|
        let ox = (r10 * a20 - r20 * a10) + (r11 * a21 - r21 * a11) + (r12 * a22 - r22 * a12);
        let oy = (r20 * a00 - r00 * a20) + (r21 * a01 - r01 * a21) + (r22 * a02 - r02 * a22);
        let oz = (r00 * a10 - r10 * a00) + (r01 * a11 - r11 * a01) + (r02 * a12 - r12 * a02);
        const dd = Math.abs(r00 * a00 + r10 * a10 + r20 * a20 + r01 * a01 + r11 * a11 + r21 * a21 + r02 * a02 + r12 * a12 + r22 * a22) + 1e-12;
        ox /= dd; oy /= dd; oz /= dd;
        const wl = Math.hypot(ox, oy, oz);
        if (wl < 1e-9) break;
        const sh = Math.sin(wl / 2) / wl, ch = Math.cos(wl / 2);
        const px = ox * sh, py = oy * sh, pz = oz * sh, pw = ch;
        // q = dq * q
        const nx = pw * qx + px * qw + py * qz - pz * qy, ny = pw * qy - px * qz + py * qw + pz * qx;
        const nz = pw * qz + px * qy - py * qx + pz * qw, nw = pw * qw - px * qx - py * qy - pz * qz;
        const ql = Math.hypot(nx, ny, nz, nw) || 1;
        q[0] = nx / ql; q[1] = ny / ql; q[2] = nz / ql; q[3] = nw / ql;
      }
      const sc = (r00 * a00 + r10 * a10 + r20 * a20 + r01 * a01 + r11 * a11 + r21 * a21 + r02 * a02 + r12 * a12 + r22 * a22) / den;
      // the share this frame (most of the way back in 0.2 s), on the floor
      const amt = 1 - Math.exp(-dt * 15);
      let low = Infinity;
      for (let n = 0; n < vs.length; n++) {
        const o = vs[n] * 3, rx = X[o] - Cx, ry = X[o + 1] - Cy, rz = X[o + 2] - Cz;
        const ty = cy + sc * (r10 * rx + r11 * ry + r12 * rz);
        if (ty < low) low = ty;
      }
      const lift = Math.max(0, -low);
      for (let n = 0; n < vs.length; n++) {
        const o = vs[n] * 3, rx = X[o] - Cx, ry = X[o + 1] - Cy, rz = X[o + 2] - Cz;
        x[o] += amt * (cx + sc * (r00 * rx + r01 * ry + r02 * rz) - x[o]);
        x[o + 1] += amt * (cy + lift + sc * (r10 * rx + r11 * ry + r12 * rz) - x[o + 1]);
        x[o + 2] += amt * (cz + sc * (r20 * rx + r21 * ry + r22 * rz) - x[o + 2]);
        v[o] = ux + (1 - amt) * (v[o] - ux);
        v[o + 1] = uy + (1 - amt) * (v[o + 1] - uy);
        v[o + 2] = uz + (1 - amt) * (v[o + 2] - uz);
      }
      this._hashDirty = true;
    }
  }

  // Surfaces passed through themselves - what a corner dragged right through
  // the body leaves, and the fold check (buried vertices) can't see once it
  // is through: surface edges of a piece piercing a surface triangle of the
  // same piece they don't touch. Counts per piece into out (for the pieces
  // with look[k]), through a grid of the triangles.
  _tangleCount(look, out) {
    const x = this.x, F = this.sTri, nF = this.nF, tp = this.tPiece, sTet = this.sTet;
    if (this._tgVersion !== this.topoVersion) {
      // the surface edges, each once: the surface is closed and turned one
      // way, so every edge runs a->b in one of its triangles and b->a in
      // the other - keep the a < b one
      const E = new Int32Array(nF * 3);
      let n = 0;
      for (let f = 0; f < nF; f++)
        for (let e = 0; e < 3; e++) {
          const a = F[f * 3 + e], b = F[f * 3 + ((e + 1) % 3)];
          if (a < b) {
            E[n++] = a;
            E[n++] = b;
          }
        }
      this._tgEdges = E.subarray(0, n);
      this._tgBox = new Float32Array(nF * 6);
      this._tgVersion = this.topoVersion;
    }
    const E = this._tgEdges, box = this._tgBox;
    const C = 0.7 * this.hCell, iC = 1 / C;
    const cells = new Map();
    for (let f = 0; f < nF; f++) {
      const k = tp[sTet[f]];
      if (!look[k]) continue;
      const a = F[f * 3] * 3, b = F[f * 3 + 1] * 3, c = F[f * 3 + 2] * 3, r = f * 6;
      for (let d = 0; d < 3; d++) {
        box[r + d] = Math.min(x[a + d], x[b + d], x[c + d]);
        box[r + 3 + d] = Math.max(x[a + d], x[b + d], x[c + d]);
      }
      for (let ix = Math.floor(box[r] * iC); ix <= Math.floor(box[r + 3] * iC); ix++)
        for (let iy = Math.floor(box[r + 1] * iC); iy <= Math.floor(box[r + 4] * iC); iy++)
          for (let iz = Math.floor(box[r + 2] * iC); iz <= Math.floor(box[r + 5] * iC); iz++) {
            const key = (ix + 512) * 1048576 + (iy + 512) * 1024 + (iz + 512), l = cells.get(key);
            if (l) l.push(f);
            else cells.set(key, [f]);
          }
    }
    const stamp = this._tgStamp && this._tgStamp.length >= nF ? this._tgStamp : (this._tgStamp = new Int32Array(Math.max(nF, 1024)));
    let st = this._tgSt || 0;
    for (let e = 0; e < E.length; e += 2) {
      const a = E[e], b = E[e + 1], k = this.vPiece[a];
      if (k < 0 || !look[k]) continue;
      const ax = x[a * 3], ay = x[a * 3 + 1], az = x[a * 3 + 2];
      const dx = x[b * 3] - ax, dy = x[b * 3 + 1] - ay, dz = x[b * 3 + 2] - az;
      const x0 = Math.min(ax, ax + dx), x1 = Math.max(ax, ax + dx), y0 = Math.min(ay, ay + dy), y1 = Math.max(ay, ay + dy), z0 = Math.min(az, az + dz), z1 = Math.max(az, az + dz);
      st++;
      for (let ix = Math.floor(x0 * iC); ix <= Math.floor(x1 * iC); ix++)
        for (let iy = Math.floor(y0 * iC); iy <= Math.floor(y1 * iC); iy++)
          for (let iz = Math.floor(z0 * iC); iz <= Math.floor(z1 * iC); iz++) {
            const l = cells.get((ix + 512) * 1048576 + (iy + 512) * 1024 + (iz + 512));
            if (!l) continue;
            for (const f of l) {
              if (stamp[f] === st) continue;
              stamp[f] = st;
              const i0 = F[f * 3], i1 = F[f * 3 + 1], i2 = F[f * 3 + 2];
              if (i0 === a || i1 === a || i2 === a || i0 === b || i1 === b || i2 === b || tp[sTet[f]] !== k) continue;
              const r = f * 6;
              if (x1 < box[r] || x0 > box[r + 3] || y1 < box[r + 1] || y0 > box[r + 4] || z1 < box[r + 2] || z0 > box[r + 5]) continue;
              // Moller-Trumbore, segment a->b against the triangle
              const p0 = i0 * 3, p1 = i1 * 3, p2 = i2 * 3;
              const e1x = x[p1] - x[p0], e1y = x[p1 + 1] - x[p0 + 1], e1z = x[p1 + 2] - x[p0 + 2];
              const e2x = x[p2] - x[p0], e2y = x[p2 + 1] - x[p0 + 1], e2z = x[p2 + 2] - x[p0 + 2];
              const qx = dy * e2z - dz * e2y, qy = dz * e2x - dx * e2z, qz = dx * e2y - dy * e2x, det = e1x * qx + e1y * qy + e1z * qz;
              if (Math.abs(det) < 1e-12) continue;
              const inv = 1 / det, tx = ax - x[p0], ty = ay - x[p0 + 1], tz = az - x[p0 + 2];
              // (clean through only, by a margin: an edge whose end just
              // touches a triangle, or that grazes its rim - as a cut's
              // snapped vertices lying on their neighbours' faces do - isn't
              // a tangle; counting those kept a tunnelled piece "untangling"
              // and awake for ever)
              const u = (tx * qx + ty * qy + tz * qz) * inv;
              if (u < 0.01 || u > 0.99) continue;
              const rx = ty * e1z - tz * e1y, ry = tz * e1x - tx * e1z, rz = tx * e1y - ty * e1x;
              const v = (dx * rx + dy * ry + dz * rz) * inv;
              if (v < 0.01 || u + v > 0.99) continue;
              const t = (e2x * rx + e2y * ry + e2z * rz) * inv;
              if (t < 0.01 || t > 0.99) continue;
              out[k]++;
            }
          }
    }
    this._tgSt = st;
  }

  // Each surface vertex's surface vertices within 2 steps of it in the mesh
  // (its neighbours', and theirs): who's its own neighbourhood, not another
  // part of its body - once a topology (see _selfCheck).
  _ring2() {
    if (this._r2Topo === this.topoVersion && this._r2N === this._nSurfV) return;
    this._r2Topo = this.topoVersion;
    this._r2N = this._nSurfV;
    const sv = this._surfV, nSV = this._nSurfV, nbS = this.nbStart, nbL = this.nbList, nV = this.nV;
    const isS = this._r2On && this._r2On.length >= nV ? this._r2On : (this._r2On = new Uint8Array(this.vCap));
    isS.fill(0, 0, nV);
    for (let q = 0; q < nSV; q++) isS[sv[q]] = 1;
    const mark = this._r2M && this._r2M.length >= nV ? this._r2M : (this._r2M = new Int32Array(this.vCap));
    mark.fill(-1, 0, nV);
    const start = this._r2S && this._r2S.length >= nSV + 1 ? this._r2S : (this._r2S = new Int32Array(nSV + 1));
    let L = this._r2L && this._r2L.length >= nSV * 24 ? this._r2L : new Int32Array(nSV * 32), n = 0;
    const put = (w) => {
      if (n >= L.length) {
        const M = new Int32Array(L.length * 2);
        M.set(L);
        L = M;
      }
      L[n++] = w;
    };
    for (let q = 0; q < nSV; q++) {
      start[q] = n;
      const i = sv[q];
      mark[i] = q;
      for (let e1 = nbS[i]; e1 < nbS[i + 1]; e1++) {
        const u = nbL[e1];
        if (mark[u] !== q) {
          mark[u] = q;
          if (isS[u]) put(u);
        }
        for (let e2 = nbS[u]; e2 < nbS[u + 1]; e2++) {
          const w = nbL[e2];
          if (mark[w] === q) continue;
          mark[w] = q;
          if (isS[w]) put(w);
        }
      }
    }
    start[nSV] = n;
    this._r2L = L;
  }

  // Of the pieces that may meet themselves, the surface vertices with some
  // other part of their own body close by - not within 2 steps of them in
  // the mesh - are flagged for probing against it; a calm body has none and
  // skips the pass. Returns whether any piece still needs it.
  _selfCheck(NP) {
    const x = this.x, D = this._disp, act = this._pieceActive, selfOK = this._selfOK, selfFlag = this._selfFlag;
    const sv = this._surfV, nSV = this._nSurfV, vp = this.vPiece, hoodA = this._hood;
    const nbS0 = this.nbStart, nbL0 = this.nbList;
    // "Close": near enough to reach the middle of the other part's nearest
    // surface triangle this frame - r0 plus how far the two move apart or
    // together (at most twice the most any of them moves within its piece);
    // cells one such reach across, so only the 27 round a vertex need looking at
    const pV = this._pVel, fdt = this._hashSpan, foldU = this._foldUntil, now = this.time;
    // (how far its surface moves within it this frame - not counting a
    // sliver's corners, damped hard and buzzing anyway: one of those set the
    // reach for the whole body - see _dampPieces)
    // (and how many outrun 3 mm a frame - a few: they're flagged anyway, and
    // the rest set the reach)
    const C2 = 0.003 * 0.003;
    let mr2 = 0, mrCalm = 0, nMov = 0, nOut = 0, sig = 0;
    const selfD = this._selfD, SL = this._sliverV;
    for (let q = 0; q < nSV; q++) {
      const i = sv[q], k = vp[i];
      if (!selfOK[k] || (SL && SL[i])) continue;
      const ux = D[i * 3] - pV[k * 3] * fdt, uy = D[i * 3 + 1] - pV[k * 3 + 1] * fdt, uz = D[i * 3 + 2] - pV[k * 3 + 2] * fdt;
      const u2 = ux * ux + uy * uy + uz * uz;
      nMov++;
      if (u2 > mr2) mr2 = u2;
      if (u2 > C2) nOut++;
      else if (u2 > mrCalm) mrCalm = u2;
    }
    for (let a = 0; a < NP; a++) if (selfOK[a]) sig = (Math.imul(sig, 31) + a + 1) | 0;
    // A calm body - all but a few of it moving less than 3 mm a frame within
    // it: what's near what hardly changes, so it's worked out every other
    // frame (the reach stretched to cover both), the same ones probing in
    // between - a cube shot full of holes, settling, spent a fifth of its
    // time here
    const calm = nOut <= Math.max(3, 0.004 * nMov);
    if (calm) mr2 = mrCalm;
    if (calm && this._selfFresh && this._selfTopo === this.topoVersion && this._selfSig === sig) {
      this._selfFresh = false;
      return this._selfStatus(NP);
    }
    this._selfFresh = calm;
    this._selfTopo = this.topoVersion;
    this._selfSig = sig;
    for (let q = 0; q < nSV; q++) {
      const i = sv[q], k = vp[i];
      // (found folded in: probed till it has popped out, see _foldCheck -
      // and kept, whatever the budget below; and, calm, the few outrunning
      // the rest)
      let f = foldU[i] > now;
      if (calm && nOut && selfOK[k] && !(SL && SL[i])) {
        const ux = D[i * 3] - pV[k * 3] * fdt, uy = D[i * 3 + 1] - pV[k * 3 + 1] * fdt, uz = D[i * 3 + 2] - pV[k * 3 + 2] * fdt;
        if (ux * ux + uy * uy + uz * uz > C2) f = true;
      }
      selfFlag[i] = f ? 1 : 0;
      selfD[i] = f ? -1 : Infinity;
    }
    const r0 = 0.72 * this.hCell + 0.01, rc = Math.min(1.3 * this.hCell, r0 + (calm ? 4 : 2) * Math.sqrt(mr2)), irc = 1 / rc, rc2 = rc * rc, r02 = r0 * r0;
    // (a table at least twice the vertices in it: a shot-up cube's thousands
    // of surface vertices in 4096 buckets shared them with other cells' - a
    // fifth of the pass was looking through those)
    let nIn = 0;
    for (let q = 0; q < nSV; q++) if (selfOK[vp[sv[q]]]) nIn++;
    let HS = 4096;
    while (HS < nIn * 2 && HS < 1 << 16) HS <<= 1;
    if (this._svStart.length < HS + 1) this._svStart = new Int32Array(HS + 1);
    if (this._svFill.length < HS) this._svFill = new Int32Array(HS);
    const HM = HS - 1, hSt = this._svStart, hLi = this._svList;
    const key = (ix, iy, iz, k) => (Math.imul(ix, 92837111) ^ Math.imul(iy, 689287499) ^ Math.imul(iz, 283923481) ^ Math.imul(k, 1640531513)) & HM;
    hSt.fill(0, 0, HS + 1);
    for (let q = 0; q < nSV; q++) {
      const i = sv[q];
      if (!selfOK[vp[i]]) continue;
      hSt[key(Math.floor(x[i * 3] * irc), Math.floor(x[i * 3 + 1] * irc), Math.floor(x[i * 3 + 2] * irc), vp[i]) + 1]++;
    }
    for (let k = 0; k < HS; k++) hSt[k + 1] += hSt[k];
    const hF = this._svFill;
    hF.set(hSt.subarray(0, HS));
    for (let q = 0; q < nSV; q++) {
      const i = sv[q];
      if (selfOK[vp[i]]) hLi[hF[key(Math.floor(x[i * 3] * irc), Math.floor(x[i * 3 + 1] * irc), Math.floor(x[i * 3 + 2] * irc), vp[i])]++] = i;
    }
    // (not a vertex's own neighbourhood - within 2 steps of it in the mesh:
    // its surface ones, worked out once a topology, see _ring2 - stamped)
    this._ring2();
    const r2S = this._r2S, r2L = this._r2L;
    let hs2 = this._hoodStamp;
    for (let q = 0; q < nSV; q++) {
      const i = sv[q], k = vp[i];
      if (!selfOK[k]) continue;
      const h1 = ++hs2;
      hoodA[i] = h1;
      for (let e = r2S[q]; e < r2S[q + 1]; e++) hoodA[r2L[e]] = h1;
      const ox = x[i * 3], oy = x[i * 3 + 1], oz = x[i * 3 + 2];
      const cx = Math.floor(ox * irc), cy = Math.floor(oy * irc), cz = Math.floor(oz * irc);
      // (each pair once: its own cell, those after it; and the 13 cells
      // ahead of it - the other 13 look at it from theirs)
      for (let n = 0; n < 14; n++) {
        const o = HALF27[n], h = key(cx + o[0], cy + o[1], cz + o[2], k), own = n === 0;
        for (let e = hSt[h]; e < hSt[h + 1]; e++) {
          const j = hLi[e];
          if ((own && j <= i) || j === i || vp[j] !== k) continue;
          const dx = x[j * 3] - ox, dy = x[j * 3 + 1] - oy, dz = x[j * 3 + 2] - oz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > rc2 || hoodA[j] === h1) continue;
          // (past the reach at rest: only as near as they're closing in
          // allows - and no Math.hypot, a fifth of the pass)
          if (d2 >= r02) {
            const mx = D[j * 3] - D[i * 3], my = D[j * 3 + 1] - D[i * 3 + 1], mz = D[j * 3 + 2] - D[i * 3 + 2], r = Math.min(rc, r0 + Math.sqrt(mx * mx + my * my + mz * mz));
            if (d2 >= r * r) continue;
          }
          selfFlag[i] = 1;
          selfFlag[j] = 1;
          if (d2 < selfD[i]) selfD[i] = d2;
          if (d2 < selfD[j]) selfD[j] = d2;
        }
      }
    }
    this._hoodStamp = hs2;
    // A budget: soft jelly shot full of holes and wobbling hard had nine in
    // ten of its surface flagged - every tunnel's walls near another's -
    // and a second a frame went on probing them. Past it, only the nearest
    // (and anything folded in) probe their own body; and face centres join
    // them only while there are few.
    const SELF_MAX = 1200;
    let nFlag = 0;
    for (let q = 0; q < nSV; q++) if (selfFlag[sv[q]]) nFlag++;
    if (nFlag > SELF_MAX) {
      const NB = 64, hist = (this._selfHist ||= new Int32Array(NB)), top = rc * rc;
      hist.fill(0);
      let forced = 0;
      for (let q = 0; q < nSV; q++) {
        const i = sv[q];
        if (!selfFlag[i]) continue;
        if (selfD[i] < 0) forced++;
        else hist[Math.min(NB - 1, Math.floor((selfD[i] / top) * NB))]++;
      }
      let keep = SELF_MAX - forced, cut = NB;
      for (let b = 0; b < NB; b++) {
        keep -= hist[b];
        if (keep < 0) {
          cut = b;
          break;
        }
      }
      const lim = (cut / NB) * top;
      nFlag = 0;
      for (let q = 0; q < nSV; q++) {
        const i = sv[q];
        if (selfFlag[i] && selfD[i] >= 0 && selfD[i] >= lim) selfFlag[i] = 0;
        if (selfFlag[i]) nFlag++;
      }
    }
    this._selfFaces = nFlag <= 400;
    return this._selfStatus(NP);
  }

  // (each piece that may meet itself: does it, after all - any of its
  // surface flagged - and how: all its tets, or those at its surface)
  _selfStatus(NP) {
    const selfOK = this._selfOK, selfFlag = this._selfFlag, act = this._pieceActive, sv = this._surfV, nSV = this._nSurfV, vp = this.vPiece, now = this.time;
    // pieces with nobody near themselves after all: no self pass
    for (let a = 0; a < NP; a++) if (selfOK[a]) selfOK[a] = 3; // (3 = none found yet)
    for (let q = 0; q < nSV; q++) {
      const i = sv[q], k = vp[i];
      if (selfOK[k] === 3 && selfFlag[i]) selfOK[k] = act[k] || this.pieces[k].foldUntil > now ? 1 : 2;
    }
    let anySelf = false;
    for (let a = 0; a < NP; a++) {
      if (selfOK[a] === 3) selfOK[a] = 0;
      if (selfOK[a]) {
        act[a] = 1;
        anySelf = true;
      }
    }
    return anySelf;
  }

  // Hash the swept boxes of the active pieces' tets, keyed by cell + piece
  // (a table sized to the entries: clearing and summing a big one costs).
  _hashTets(ptL) {
    const { x, T } = this;
    const nT = this.nT, D = this._disp, sw = this._sweep, pcs = this._pcs, act = this._pieceActive, selfOK = this._selfOK;
    const bb = this._pbb, pV = this._pVel, ptS = this._ptS, fdt = this._hashSpan;
    const counts = this._hCount && this._hCount.length === (1 << 15) + 1 ? this._hCount : (this._hCount = new Int32Array((1 << 15) + 1));
    const tbox = this._tBox0 && this._tBox0.length >= nT * 6 ? this._tBox0 : (this._tBox0 = new Float32Array(this.tCap * 6));
    const ranges = this._hRanges && this._hRanges.length >= nT * 6 ? this._hRanges : (this._hRanges = new Int32Array(this.tCap * 6));
    const list = this._hTets && this._hTets.length >= nT ? this._hTets : (this._hTets = new Int32Array(this.tCap));
    // per tet: centre, radius, the centre's move this frame and how far its
    // corners stray from that (a cheap sphere test before the exact one)
    const tS = this._tStat && this._tStat.length >= nT * 8 ? this._tStat : (this._tStat = new Float32Array(this.tCap * 8));
    let nList = 0, total = 0;
    const tp = this.tPiece;
    const tSurf = this._tSurf;
    for (let t = 0; t < nT; t++) {
      if (!act[tp[t]] || this.vol0[t] <= 0) continue;
      if (selfOK[tp[t]] === 2 && !tSurf[t]) continue;
      const o = t * 4, r = t * 6;
      const a = T[o] * 6, b = T[o + 1] * 6, c = T[o + 2] * 6, d = T[o + 3] * 6;
      {
        const a3 = T[o] * 3, b3 = T[o + 1] * 3, c3 = T[o + 2] * 3, d3 = T[o + 3] * 3, s8 = t * 8;
        const cx = (x[a3] + x[b3] + x[c3] + x[d3]) * 0.25, cy = (x[a3 + 1] + x[b3 + 1] + x[c3 + 1] + x[d3 + 1]) * 0.25, cz = (x[a3 + 2] + x[b3 + 2] + x[c3 + 2] + x[d3 + 2]) * 0.25;
        const mx = (D[a3] + D[b3] + D[c3] + D[d3]) * 0.25, my = (D[a3 + 1] + D[b3 + 1] + D[c3 + 1] + D[d3 + 1]) * 0.25, mz = (D[a3 + 2] + D[b3 + 2] + D[c3 + 2] + D[d3 + 2]) * 0.25;
        let r2 = 0, m2 = 0;
        for (let j = 0; j < 4; j++) {
          const q = T[o + j] * 3;
          const ux = x[q] - cx, uy = x[q + 1] - cy, uz = x[q + 2] - cz;
          const u2 = ux * ux + uy * uy + uz * uz;
          if (u2 > r2) r2 = u2;
          const wx = D[q] - mx, wy = D[q + 1] - my, wz = D[q + 2] - mz;
          const w2 = wx * wx + wy * wy + wz * wz;
          if (w2 > m2) m2 = w2;
        }
        tS[s8] = cx; tS[s8 + 1] = cy; tS[s8 + 2] = cz; tS[s8 + 3] = Math.sqrt(r2);
        tS[s8 + 4] = mx; tS[s8 + 5] = my; tS[s8 + 6] = mz; tS[s8 + 7] = Math.sqrt(m2);
      }
      const inv = pcs[tp[t]];
      const x0 = Math.min(sw[a], sw[b], sw[c], sw[d]), y0 = Math.min(sw[a + 1], sw[b + 1], sw[c + 1], sw[d + 1]), z0 = Math.min(sw[a + 2], sw[b + 2], sw[c + 2], sw[d + 2]);
      const x1 = Math.max(sw[a + 3], sw[b + 3], sw[c + 3], sw[d + 3]), y1 = Math.max(sw[a + 4], sw[b + 4], sw[c + 4], sw[d + 4]), z1 = Math.max(sw[a + 5], sw[b + 5], sw[c + 5], sw[d + 5]);
      tbox[r] = x0; tbox[r + 1] = y0; tbox[r + 2] = z0; tbox[r + 3] = x1; tbox[r + 4] = y1; tbox[r + 5] = z1;
      // (only what a probe of another piece could reach: within that piece's box swept by how it moves against
      // this one (as _gatherProbes sweeps its probes) - a cube touching another had its every tet hashed, the
      // far side too, for a few probes along the seam. Its own probes look at it only where it can fold.)
      const k = tp[t];
      if (!selfOK[k]) {
        let near = false;
        for (let e = ptS[k]; e < ptS[k + 1] && !near; e++) {
          const pb = ptL[e], B = pb * 6;
          const rx = (pV[pb * 3] - pV[k * 3]) * fdt, ry = (pV[pb * 3 + 1] - pV[k * 3 + 1]) * fdt, rz = (pV[pb * 3 + 2] - pV[k * 3 + 2]) * fdt;
          const rm = 0.12 * (Math.abs(rx) + Math.abs(ry) + Math.abs(rz)) + 0.002;
          near = !(x1 < bb[B] + Math.min(0, rx) - rm || x0 > bb[B + 3] + Math.max(0, rx) + rm || y1 < bb[B + 1] + Math.min(0, ry) - rm || y0 > bb[B + 4] + Math.max(0, ry) + rm || z1 < bb[B + 2] + Math.min(0, rz) - rm || z0 > bb[B + 5] + Math.max(0, rz) + rm);
        }
        if (!near) continue;
      }
      const ix0 = Math.floor(x0 * inv), ix1 = Math.floor(x1 * inv);
      const iy0 = Math.floor(y0 * inv), iy1 = Math.floor(y1 * inv);
      const iz0 = Math.floor(z0 * inv), iz1 = Math.floor(z1 * inv);
      if ((ix1 - ix0 + 1) * (iy1 - iy0 + 1) * (iz1 - iz0 + 1) > 4096) continue; // torn to bits
      const rr = nList * 6;
      ranges[rr] = ix0; ranges[rr + 1] = ix1; ranges[rr + 2] = iy0; ranges[rr + 3] = iy1; ranges[rr + 4] = iz0; ranges[rr + 5] = iz1;
      list[nList++] = t;
      total += (ix1 - ix0 + 1) * (iy1 - iy0 + 1) * (iz1 - iz0 + 1);
    }
    this._nHTets = nList;
    let size = 1024;
    while (size < total * 2 && size < 1 << 15) size <<= 1;
    const mask = size - 1;
    counts.fill(0, 0, size + 1);
    for (let n = 0; n < nList; n++) {
      const r = n * 6, pk = Math.imul(tp[list[n]], 1640531513);
      for (let ix = ranges[r]; ix <= ranges[r + 1]; ix++)
        for (let iy = ranges[r + 2]; iy <= ranges[r + 3]; iy++)
          for (let iz = ranges[r + 4]; iz <= ranges[r + 5]; iz++)
            counts[((Math.imul(ix, 92837111) ^ Math.imul(iy, 689287499) ^ Math.imul(iz, 283923481) ^ pk) & mask) + 1]++;
    }
    for (let k = 0; k < size; k++) counts[k + 1] += counts[k];
    const entries = this._hEntries && this._hEntries.length >= total ? this._hEntries : (this._hEntries = new Int32Array(Math.max(total, 1024) * 2));
    const fill = this._hFill && this._hFill.length === 1 << 15 ? this._hFill : (this._hFill = new Int32Array(1 << 15));
    fill.set(counts.subarray(0, size));
    for (let n = 0; n < nList; n++) {
      const r = n * 6, t = list[n], pk = Math.imul(tp[t], 1640531513);
      for (let ix = ranges[r]; ix <= ranges[r + 1]; ix++)
        for (let iy = ranges[r + 2]; iy <= ranges[r + 3]; iy++)
          for (let iz = ranges[r + 4]; iz <= ranges[r + 5]; iz++)
            entries[fill[(Math.imul(ix, 92837111) ^ Math.imul(iy, 689287499) ^ Math.imul(iz, 283923481) ^ pk) & mask]++] = t;
    }
    this._hMask = mask;
  }

  // Probes (surface vertices, face centres) and their candidate tets for
  // this frame's contact passes.
  _gatherProbes(ptL) {
    const { x, T } = this;
    const nT = this.nT, nV = this.nV, NP = this.pieces.length, tp = this.tPiece;
    const fdt = this._hashSpan, GP = this.grabs.length ? this._grabbedP : null;
    const D = this._disp, pV = this._pVel, sw = this._sweep, bb = this._pbb, pcs = this._pcs;
    const act = this._pieceActive, ptS = this._ptS, selfOK = this._selfOK, selfFlag = this._selfFlag;
    const counts = this._hCount, entries = this._hEntries, tbox = this._tBox0, tS = this._tStat, mask = this._hMask;
    // probes and their candidate tets
    const sTri = this.sTri, nF = this.nF;
    const pvv = this._probeV && this._probeV.length >= nV ? this._probeV : (this._probeV = new Int32Array(Math.max(this.vCap, 1024)));
    const pff = this._probeF && this._probeF.length >= nF ? this._probeF : (this._probeF = new Int32Array(Math.max(nF * 2, 1024)));
    const nPmax = nV + nF;
    const nS = this._pcStart && this._pcStart.length >= nPmax ? this._pcStart : (this._pcStart = new Int32Array((this.vCap + Math.max(nF, 1024)) * 2));
    const nE = this._pcEnd && this._pcEnd.length >= nPmax ? this._pcEnd : (this._pcEnd = new Int32Array((this.vCap + Math.max(nF, 1024)) * 2));
    const rel = this._pRel && this._pRel.length >= nPmax ? this._pRel : (this._pRel = new Float32Array((this.vCap + Math.max(nF, 1024)) * 2));
    const seen = this._probeSeen && this._probeSeen.length >= nV ? this._probeSeen : (this._probeSeen = new Uint8Array(this.vCap));
    seen.fill(0, 0, nV);
    const tStamp = this._tStamp && this._tStamp.length >= nT ? this._tStamp : (this._tStamp = new Int32Array(this.tCap));
    tStamp.fill(0, 0, nT);
    let stamp = 0;
    let cList = this._cList || (this._cList = new Int32Array(1 << 16));
    let nc = 0, gRel = 0, gGrab = false;
    // Other-piece tets the probe at p (moving dp this frame, box x0..z1) could
    // reach this frame: swept boxes that meet, minus tets it stays clear of -
    // seen along the line from the tet's centre to p, the gap can only close
    // as fast as the tet's corners move toward p relative to it (+ 12% and
    // 3 mm for changes of course). gRel = the fastest any kept tet's corner
    // moves relative to p (a closing speed bound, per frame).
    // A probe flagged by _selfCheck (vertex vi >= 0, face -2 - vi) also
    // meets its own piece's tets - all but those touching it (a face: its
    // corners) or their neighbours: reaching any of those means the body has
    // folded onto itself (or a part hanging by a hinge has swung into the
    // rest; across a cut the neighbours are only those on its side).
    const nbS = this.nbStart, nbL = this.nbList, hood = this._hood;
    if (this._hoodStamp > 2e9) {
      hood.fill(0);
      this._hoodStamp = 0;
    }
    let hs = this._hoodStamp;
    // (face centres too only for watery jelly, whose folds slide edge over
    // face; a firm piece on a hinge is held well enough by its vertices)
    const softC = this.cMu, PP = this.pieces, selfFaces = this._selfFaces;
    const gather = (qx0, qy0, qz0, qx1, qy1, qz1, own, px, py, pz, dpx, dpy, dpz, vi) => {
      const st = ++stamp;
      const c0 = nc;
      gRel = 0;
      gGrab = !!(GP && GP[own]);
      const self = selfOK[own] > 0 && (vi >= 0 ? selfFlag[vi] === 1 : selfFaces && softC[PP[own].cube] < 110 && vi < -1 && (selfFlag[sTri[(-2 - vi) * 3]] | selfFlag[sTri[(-2 - vi) * 3 + 1]] | selfFlag[sTri[(-2 - vi) * 3 + 2]]) === 1);
      if (self) {
        hs++;
        if (vi >= 0) {
          hood[vi] = hs;
          for (let k = nbS[vi]; k < nbS[vi + 1]; k++) hood[nbL[k]] = hs;
        } else {
          const ff = -2 - vi;
          for (let c = 0; c < 3; c++) {
            const u = sTri[ff * 3 + c];
            hood[u] = hs;
            for (let k = nbS[u]; k < nbS[u + 1]; k++) hood[nbL[k]] = hs;
          }
        }
      }
      const e0 = ptS[own], e1 = ptS[own + 1] + (self ? 1 : 0);
      for (let e = e0; e < e1; e++) {
        const mine = e === ptS[own + 1];
        const pb = mine ? own : ptL[e], B = pb * 6;
        // the probe's box, swept by how its piece moves relative to pb
        const rx = (pV[own * 3] - pV[pb * 3]) * fdt, ry = (pV[own * 3 + 1] - pV[pb * 3 + 1]) * fdt, rz = (pV[own * 3 + 2] - pV[pb * 3 + 2]) * fdt;
        const rm = 0.12 * (Math.abs(rx) + Math.abs(ry) + Math.abs(rz));
        const x0 = qx0 + Math.min(0, rx) - rm, y0 = qy0 + Math.min(0, ry) - rm, z0 = qz0 + Math.min(0, rz) - rm;
        const x1 = qx1 + Math.max(0, rx) + rm, y1 = qy1 + Math.max(0, ry) + rm, z1 = qz1 + Math.max(0, rz) + rm;
        if (x1 < bb[B] || x0 > bb[B + 3] || y1 < bb[B + 1] || y0 > bb[B + 4] || z1 < bb[B + 2] || z0 > bb[B + 5]) continue;
        const pk = Math.imul(pb, 1640531513), inv = pcs[pb];
        const ix0 = Math.floor(x0 * inv), ix1 = Math.floor(x1 * inv);
        const iy0 = Math.floor(y0 * inv), iy1 = Math.floor(y1 * inv);
        const iz0 = Math.floor(z0 * inv), iz1 = Math.floor(z1 * inv);
        const n0 = nc;
        for (let ix = ix0; ix <= ix1; ix++)
          for (let iy = iy0; iy <= iy1; iy++)
            for (let iz = iz0; iz <= iz1; iz++) {
              const hsh = (Math.imul(ix, 92837111) ^ Math.imul(iy, 689287499) ^ Math.imul(iz, 283923481) ^ pk) & mask;
              for (let q = counts[hsh]; q < counts[hsh + 1]; q++) {
                const t = entries[q];
                if (tStamp[t] === st || tp[t] !== pb) continue;
                tStamp[t] = st;
                if (mine && (hood[T[t * 4]] === hs || hood[T[t * 4 + 1]] === hs || hood[T[t * 4 + 2]] === hs || hood[T[t * 4 + 3]] === hs)) continue;
                const r = t * 6;
                if (x1 < tbox[r] || x0 > tbox[r + 3] || y1 < tbox[r + 1] || y0 > tbox[r + 4] || z1 < tbox[r + 2] || z0 > tbox[r + 5]) continue;
                const s8 = t * 8;
                let nx = px - tS[s8], ny = py - tS[s8 + 1], nz = pz - tS[s8 + 2];
                const L = Math.sqrt(nx * nx + ny * ny + nz * nz);
                if (L > 1e-7) {
                  const il = 1 / L;
                  nx *= il; ny *= il; nz *= il;
                  // sphere round the tet first
                  const ux = tS[s8 + 4] - dpx, uy = tS[s8 + 5] - dpy, uz = tS[s8 + 6] - dpz, sd = tS[s8 + 7];
                  const cs = ux * nx + uy * ny + uz * nz + sd;
                  if (L - tS[s8 + 3] - (cs > 0 ? cs : 0) > 0.003 + 0.12 * (Math.sqrt(ux * ux + uy * uy + uz * uz) + sd)) continue;
                }
                // its corners
                let ext = -Infinity, cr = -Infinity, m2 = 0;
                for (let j = 0; j < 4; j++) {
                  const q = T[t * 4 + j] * 3;
                  const ex = (x[q] - tS[s8]) * nx + (x[q + 1] - tS[s8 + 1]) * ny + (x[q + 2] - tS[s8 + 2]) * nz;
                  if (ex > ext) ext = ex;
                  const ux = D[q] - dpx, uy = D[q + 1] - dpy, uz = D[q + 2] - dpz;
                  const c = ux * nx + uy * ny + uz * nz;
                  if (c > cr) cr = c;
                  const u2 = ux * ux + uy * uy + uz * uz;
                  if (u2 > m2) m2 = u2;
                }
                const mr = Math.sqrt(m2);
                if (L > 1e-7 && L - ext - (cr > 0 ? cr : 0) > 0.003 + 0.12 * mr) continue;
                if (mr > gRel) gRel = mr;
                if (GP && GP[pb]) gGrab = true;
                if (nc >= cList.length) {
                  const grown = new Int32Array(cList.length * 2);
                  grown.set(cList);
                  cList = this._cList = grown;
                }
                cList[nc++] = t;
              }
            }
      }
      return nc > c0;
    };
    // Closing speed a probe's clearance is spent at (see _solvePieceCollisions):
    // the frame's speeds can double (a bounce off something else), and a
    // grabbed piece can be hauled at the grab's per-substep cap on top.
    const ifdt = 1 / fdt, capV = (0.012 * this.p.size * this.p.substeps) / fdt;
    const closing = () => 2 * gRel * ifdt + 1 + (gGrab ? capV : 0);
    let nv = 0, nf = 0;
    const vStart = this._vcS && this._vcS.length >= nV ? this._vcS : (this._vcS = new Int32Array(this.vCap));
    const vEnd = this._vcE && this._vcE.length >= nV ? this._vcE : (this._vcE = new Int32Array(this.vCap));
    const vRel = this._vcR && this._vcR.length >= nV ? this._vcR : (this._vcR = new Float32Array(this.vCap));
    const fS = this._fcS && this._fcS.length >= nF ? this._fcS : (this._fcS = new Int32Array(Math.max(nF * 2, 1024)));
    const fE = this._fcE && this._fcE.length >= nF ? this._fcE : (this._fcE = new Int32Array(Math.max(nF * 2, 1024)));
    const fR = this._fcR && this._fcR.length >= nF ? this._fcR : (this._fcR = new Float32Array(Math.max(nF * 2, 1024)));
    const faces = this.faceProbes !== false;
    for (let f = 0; f < nF; f++) {
      const own = tp[this.sTet[f]];
      if (!act[own]) continue;
      for (let j = 0; j < 3; j++) {
        const i = sTri[f * 3 + j];
        if (seen[i]) continue;
        seen[i] = 1;
        const r = i * 6, o = i * 3;
        const c0 = nc;
        if (gather(sw[r], sw[r + 1], sw[r + 2], sw[r + 3], sw[r + 4], sw[r + 5], own, x[o], x[o + 1], x[o + 2], D[o], D[o + 1], D[o + 2], i)) {
          vStart[nv] = c0;
          vEnd[nv] = nc;
          vRel[nv] = closing();
          pvv[nv++] = i;
        }
      }
      if (!faces) continue;
      // the face centre's swept box (mean of its corners' boxes)
      const a = sTri[f * 3] * 6, b = sTri[f * 3 + 1] * 6, c = sTri[f * 3 + 2] * 6;
      const a3 = sTri[f * 3] * 3, b3 = sTri[f * 3 + 1] * 3, c3 = sTri[f * 3 + 2] * 3;
      const c0 = nc;
      if (gather((sw[a] + sw[b] + sw[c]) / 3, (sw[a + 1] + sw[b + 1] + sw[c + 1]) / 3, (sw[a + 2] + sw[b + 2] + sw[c + 2]) / 3,
        (sw[a + 3] + sw[b + 3] + sw[c + 3]) / 3, (sw[a + 4] + sw[b + 4] + sw[c + 4]) / 3, (sw[a + 5] + sw[b + 5] + sw[c + 5]) / 3, own,
        (x[a3] + x[b3] + x[c3]) / 3, (x[a3 + 1] + x[b3 + 1] + x[c3 + 1]) / 3, (x[a3 + 2] + x[b3 + 2] + x[c3 + 2]) / 3,
        (D[a3] + D[b3] + D[c3]) / 3, (D[a3 + 1] + D[b3 + 1] + D[c3 + 1]) / 3, (D[a3 + 2] + D[b3 + 2] + D[c3 + 2]) / 3, -2 - f)) {
        fS[nf] = c0;
        fE[nf] = nc;
        fR[nf] = closing();
        pff[nf++] = f;
      }
    }
    // one candidate range per probe: vertex probes first, then faces
    for (let k = 0; k < nv; k++) {
      nS[k] = vStart[k];
      nE[k] = vEnd[k];
      rel[k] = vRel[k];
    }
    for (let k = 0; k < nf; k++) {
      nS[nv + k] = fS[k];
      nE[nv + k] = fE[k];
      rel[nv + k] = fR[k];
    }
    this._nProbeV = nv;
    this._nProbeF = nf;
    this._hoodStamp = hs;
    // clearance left per probe: a probe that missed by a margin skips the
    // following substeps until the pieces could have closed that gap
    const nPr = nv + nf;
    if (!this._skip || this._skip.length < nPr) this._skip = new Float32Array(Math.max(nPr * 2, 4096));
    this._skip.fill(0, 0, nPr);
    if (!this._tBoxNow || this._tBoxNow.length < nT * 6) {
      this._tBoxNow = new Float32Array(this.tCap * 6);
      this._tBoxStamp = new Int32Array(this.tCap);
    }
  }


  // Is p inside tet t? Returns -1 if so (barycentric coordinates into
  // this._ct), else a lower bound on its distance to the tet: how far it is
  // outside the first face plane found that separates them.
  _tetGap(t, px, py, pz) {
    const x = this.x, T = this.T, t4 = t * 4;
    const a = T[t4] * 3, b = T[t4 + 1] * 3, c = T[t4 + 2] * 3, d = T[t4 + 3] * 3;
    const ax = x[a], ay = x[a + 1], az = x[a + 2];
    const e1x = x[b] - ax, e1y = x[b + 1] - ay, e1z = x[b + 2] - az;
    const e2x = x[c] - ax, e2y = x[c + 1] - ay, e2z = x[c + 2] - az;
    const e3x = x[d] - ax, e3y = x[d + 1] - ay, e3z = x[d + 2] - az;
    const c0x = e2y * e3z - e2z * e3y, c0y = e2z * e3x - e2x * e3z, c0z = e2x * e3y - e2y * e3x;
    const det = e1x * c0x + e1y * c0y + e1z * c0z;
    if (det <= 1e-15) return Infinity;
    const rx = px - ax, ry = py - ay, rz = pz - az;
    // s_k = det x barycentric k = det x (distance to the face opposite k) / height
    const s1 = rx * c0x + ry * c0y + rz * c0z;
    if (s1 < 0) return -s1 / Math.sqrt(c0x * c0x + c0y * c0y + c0z * c0z);
    const qx = ry * e1z - rz * e1y, qy = rz * e1x - rx * e1z, qz = rx * e1y - ry * e1x; // r x e1
    const s2 = -(e3x * qx + e3y * qy + e3z * qz);
    if (s2 < 0) {
      const nx = e1y * e3z - e1z * e3y, ny = e1z * e3x - e1x * e3z, nz = e1x * e3y - e1y * e3x;
      return -s2 / Math.sqrt(nx * nx + ny * ny + nz * nz);
    }
    const s3 = e2x * qx + e2y * qy + e2z * qz;
    if (s3 < 0) {
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      return -s3 / Math.sqrt(nx * nx + ny * ny + nz * nz);
    }
    const s0 = det - s1 - s2 - s3;
    if (s0 < 0) {
      const fx = e2x - e1x, fy = e2y - e1y, fz = e2z - e1z, gx = e3x - e1x, gy = e3y - e1y, gz = e3z - e1z;
      const nx = fy * gz - fz * gy, ny = fz * gx - fx * gz, nz = fx * gy - fy * gx;
      return -s0 / Math.sqrt(nx * nx + ny * ny + nz * nz);
    }
    const ct = this._ct, id = 1 / det;
    ct.b0 = s0 * id; ct.b1 = s1 * id; ct.b2 = s2 * id; ct.b3 = s3 * id;
    return -1;
  }

  // Geometry of boundary face f this contact pass (cached): anchor a, edges
  // u v, unit outward normal, Gram terms for projecting onto it. False for
  // degenerate faces.
  _faceGeo(f) {
    const G = this._fGeo, o = f * 16;
    if (this._fGeoStamp[f] === this._pass) return G[o + 15] !== 0;
    this._fGeoStamp[f] = this._pass;
    const x = this.x, sTri = this.sTri;
    const fa = sTri[f * 3] * 3, fb = sTri[f * 3 + 1] * 3, fc = sTri[f * 3 + 2] * 3;
    const ax = x[fa], ay = x[fa + 1], az = x[fa + 2];
    const ux = x[fb] - ax, uy = x[fb + 1] - ay, uz = x[fb + 2] - az;
    const vx = x[fc] - ax, vy = x[fc + 1] - ay, vz = x[fc + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    const d00 = ux * ux + uy * uy + uz * uz, d01 = ux * vx + uy * vy + uz * vz, d11 = vx * vx + vy * vy + vz * vz;
    const den = d00 * d11 - d01 * d01;
    if (l < 1e-14 || den < 1e-20) {
      G[o + 15] = 0;
      return false;
    }
    G[o] = ax; G[o + 1] = ay; G[o + 2] = az;
    G[o + 3] = ux; G[o + 4] = uy; G[o + 5] = uz;
    G[o + 6] = vx; G[o + 7] = vy; G[o + 8] = vz;
    G[o + 9] = nx / l; G[o + 10] = ny / l; G[o + 11] = nz / l;
    G[o + 12] = d00; G[o + 13] = d01; G[o + 14] = d11;
    G[o + 15] = 1 / den;
    return true;
  }

  // Is the point (wx, wy, wz) relative to face f's anchor within the face's
  // outline grown by tol (in barycentric units)?
  _onFace(o, wx, wy, wz, tol) {
    const G = this._fGeo;
    const d20 = wx * G[o + 3] + wy * G[o + 4] + wz * G[o + 5], d21 = wx * G[o + 6] + wy * G[o + 7] + wz * G[o + 8];
    const id = G[o + 15];
    const be = (G[o + 14] * d20 - G[o + 13] * d21) * id, ga = (G[o + 12] * d21 - G[o + 13] * d20) * id;
    return be >= -tol && ga >= -tol && be + ga <= 1 + tol;
  }

  // Boundary face f against point p (previous q): depth behind its plane now
  // and before (> 0 = inside), whether p's projection lies on the face, and
  // where the path crossed the plane (crossS, if it came in through it).
  // `need` = 1: only the depth/on test, 2: also the crossing.
  _faceProbe(f, px, py, pz, qx, qy, qz) {
    const fq = this._fq;
    fq.ok = false;
    if (!this._faceGeo(f)) return;
    const G = this._fGeo, o = f * 16;
    const ax = G[o], ay = G[o + 1], az = G[o + 2], nx = G[o + 9], ny = G[o + 10], nz = G[o + 11];
    let dist = -((px - ax) * nx + (py - ay) * ny + (pz - az) * nz);
    // in front of it: not a way out. (Right on it is one, at depth 0: the
    // two sides of a fresh cut lie exactly on each other's faces, and with
    // the near face ruled out a thin slice's far face - a few cm away -
    // was the way out: every vertex of a sliced loaf was shoved through its
    // neighbour, and the slices blew apart at the speed limit.)
    if (dist < -1e-7) return;
    if (dist < 0) dist = 0;
    // pushing out this way would land under the floor / in the arena wall:
    // useless (it just gets pushed back in), so don't. (Against another piece
    // a face only tilted a little down is fine: the floor lifts the last
    // millimetres. Ruling those out left a piece lying on the floor that had
    // sunk into another one only the far faces, up through its top: it was
    // hauled up and dropped back every substep - two pieces kicking each
    // other for good. A fold of its own body is the other way round: out
    // through its underside is how a fold gets pushed through itself.)
    const ex = px + nx * dist, ey = py + ny * dist, ez = pz + nz * dist;
    const R = this.p.arenaRadius;
    if (ex * ex + ez * ez > R * R) return;
    if (this._fSelf ? ny < 0 && ey < 0.002 : (ny < -0.5 && ey < 0.002) || ey < -0.015) return;
    const prev = -((qx - ax) * nx + (qy - ay) * ny + (qz - az) * nz);
    fq.ok = true;
    fq.dist = dist; fq.prev = prev; fq.nx = nx; fq.ny = ny; fq.nz = nz;
    fq.on = this._onFace(o, ex - ax, ey - ay, ez - az, 0.15);
    fq.crossS = Infinity;
    if (prev <= 0) {
      // where the path met the plane
      const s = prev / (prev - dist);
      if (this._onFace(o, qx + (px - qx) * s - ax, qy + (py - qy) * s - ay, qz + (pz - qz) * s - az, 0.08)) fq.crossS = s;
    }
  }

  // Is point p (previous position q) of piece `own` inside another piece?
  // Tries the tet it was in last substep (wt), then the frame's candidate
  // tets cList[c0..c1). Push-out direction: the boundary face the path
  // entered through this substep, else the nearest face it lies behind
  // (last substep's face wf first), else - deep inside - the interpolated
  // escape field. Result in this._ct: tet t, face f (-1 = escape field),
  // bary b0..b3, unit normal n, depth.
  _contact(px, py, pz, qx, qy, qz, c0, c1, own, wt, wf) {
    const { T, tPiece } = this;
    const ct = this._ct, fq = this._fq;
    let t = -1;
    // (a warm tet of its own piece is fine: it came from a self-contact
    // candidate list, which leaves out the probe's own neighbourhood)
    const gw = wt >= 0 && wt < this.nT && this.vol0[wt] > 0 ? this._tetGap(wt, px, py, pz) : Infinity;
    if (gw < 0) t = wt;
    else {
      // scan the candidates; on a miss, remember how far the nearest was
      const cl = this._cList, tb = this._tBoxNow, tbs = this._tBoxStamp, pass = this._pass;
      const x = this.x;
      let gap = gw;
      for (let e = c0; e < c1; e++) {
        const u = cl[e];
        if (u === wt) continue;
        const r = u * 6;
        if (tbs[u] !== pass) {
          // this pass's box of the tet: a cheap reject, and a lower bound on
          // the distance when it does reject
          tbs[u] = pass;
          const o = u * 4;
          const a = T[o] * 3, b = T[o + 1] * 3, c = T[o + 2] * 3, d = T[o + 3] * 3;
          let v0 = x[a], v1 = x[b], v2 = x[c], v3 = x[d];
          tb[r] = Math.min(v0, v1, v2, v3); tb[r + 3] = Math.max(v0, v1, v2, v3);
          v0 = x[a + 1]; v1 = x[b + 1]; v2 = x[c + 1]; v3 = x[d + 1];
          tb[r + 1] = Math.min(v0, v1, v2, v3); tb[r + 4] = Math.max(v0, v1, v2, v3);
          v0 = x[a + 2]; v1 = x[b + 2]; v2 = x[c + 2]; v3 = x[d + 2];
          tb[r + 2] = Math.min(v0, v1, v2, v3); tb[r + 5] = Math.max(v0, v1, v2, v3);
        }
        const ox = Math.max(tb[r] - px, px - tb[r + 3]), oy = Math.max(tb[r + 1] - py, py - tb[r + 4]), oz = Math.max(tb[r + 2] - pz, pz - tb[r + 5]);
        const out = Math.max(ox, oy, oz);
        if (out > 0) {
          if (out < gap) gap = out;
          continue;
        }
        const g = this._tetGap(u, px, py, pz);
        if (g < 0) {
          t = u;
          break;
        }
        if (g < gap) gap = g;
      }
      if (t < 0) {
        this._gap = gap;
        return false;
      }
    }
    ct.t = t;
    const pt = tPiece[t];
    this._fSelf = pt === own;
    // still behind last substep's face?
    if (wf >= 0 && wf < this.nF && tPiece[this.sTet[wf]] === pt) {
      this._faceProbe(wf, px, py, pz, qx, qy, qz);
      // (only while shallow: deep in - a thin slice folded over another -
      // the face it came in by can be the far side of everything, 12 cm off)
      if (fq.ok && fq.on && (fq.prev > 0 || fq.dist < 0.004) && fq.dist < 0.02) {
        ct.f = wf; ct.nx = fq.nx; ct.ny = fq.ny; ct.nz = fq.nz; ct.depth = fq.dist;
        return true;
      }
    }
    // the boundary faces around this tet's vertices
    const t4 = t * 4;
    const vfS = this.vfStart, vfL = this.vfList, seen = this._fSeen;
    const stamp = ++this._fStamp;
    let cross = -1, crossS = Infinity, crossD = 0, cnx = 0, cny = 0, cnz = 0;
    let best = -1, bestD = Infinity, bnx = 0, bny = 0, bnz = 0;
    for (let k = 0; k < 4; k++) {
      const vi = T[t4 + k];
      for (let ef = vfS[vi]; ef < vfS[vi + 1]; ef++) {
        const f = vfL[ef];
        if (seen[f] === stamp) continue;
        seen[f] = stamp;
        this._faceProbe(f, px, py, pz, qx, qy, qz);
        if (!fq.ok) continue; // (only faces it lies behind)
        if (fq.crossS < crossS) {
          crossS = fq.crossS; cross = f; crossD = fq.dist; cnx = fq.nx; cny = fq.ny; cnz = fq.nz;
        }
        // (a face it's barely behind is a way out even if it lies just
        // beside the triangle: only the triangles round this tet's corners
        // are asked, and a thin slice's near face can be the next triangle
        // over - with only the far face "on", a whole slice's thickness away,
        // a sliced loaf shoved every vertex through its neighbour)
        if (fq.dist < bestD && (fq.on || fq.dist < 0.004)) {
          bestD = fq.dist; best = f; bnx = fq.nx; bny = fq.ny; bnz = fq.nz;
        }
      }
    }
    // the face it came in through - unless that is much deeper than the
    // nearest one, i.e. it merely slid over an edge (or the face came to it)
    const mx = px - qx, my = py - qy, mz = pz - qz;
    if (cross >= 0 && (best < 0 || crossD <= bestD + Math.sqrt(mx * mx + my * my + mz * mz))) {
      ct.f = cross; ct.nx = cnx; ct.ny = cny; ct.nz = cnz; ct.depth = crossD;
      return true;
    }
    if (best >= 0) {
      ct.f = best; ct.nx = bnx; ct.ny = bny; ct.nz = bnz; ct.depth = bestD;
      return true;
    }
    // deep: follow the escape field (rest space), mapped through F = Ds Dm^-1
    ct.f = -1;
    const x = this.x, E = this.esc;
    const ia = T[t4], ib = T[t4 + 1], ic = T[t4 + 2], idd = T[t4 + 3];
    const b0 = ct.b0, b1 = ct.b1, b2 = ct.b2, b3 = ct.b3;
    let ex = E[ia * 3] * b0 + E[ib * 3] * b1 + E[ic * 3] * b2 + E[idd * 3] * b3;
    let ey = E[ia * 3 + 1] * b0 + E[ib * 3 + 1] * b1 + E[ic * 3 + 1] * b2 + E[idd * 3 + 1] * b3;
    let ez = E[ia * 3 + 2] * b0 + E[ib * 3 + 2] * b1 + E[ic * 3 + 2] * b2 + E[idd * 3 + 2] * b3;
    if (ex * ex + ey * ey + ez * ez < 1e-8) {
      // on a medial line the field cancels: use the strongest vertex's
      const bs = [b0, b1, b2, b3], vs = [ia, ib, ic, idd];
      let km = 0;
      for (let k = 1; k < 4; k++) if (bs[k] > bs[km]) km = k;
      ex = E[vs[km] * 3]; ey = E[vs[km] * 3 + 1]; ez = E[vs[km] * 3 + 2];
    }
    const a = ia * 3, b = ib * 3, c = ic * 3, d = idd * 3;
    const e1x = x[b] - x[a], e1y = x[b + 1] - x[a + 1], e1z = x[b + 2] - x[a + 2];
    const e2x = x[c] - x[a], e2y = x[c + 1] - x[a + 1], e2z = x[c + 2] - x[a + 2];
    const e3x = x[d] - x[a], e3y = x[d + 1] - x[a + 1], e3z = x[d + 2] - x[a + 2];
    const B = this.B, bo = t * 9;
    const y0 = B[bo] * ex + B[bo + 1] * ey + B[bo + 2] * ez;
    const y1 = B[bo + 3] * ex + B[bo + 4] * ey + B[bo + 5] * ez;
    const y2 = B[bo + 6] * ex + B[bo + 7] * ey + B[bo + 8] * ez;
    const wx = e1x * y0 + e2x * y1 + e3x * y2, wy = e1y * y0 + e2y * y1 + e3y * y2, wz = e1z * y0 + e2z * y1 + e3z * y2;
    const wl = Math.sqrt(wx * wx + wy * wy + wz * wz);
    if (wl < 1e-9) return false;
    ct.nx = wx / wl; ct.ny = wy / wl; ct.nz = wz / wl;
    // (a badly squashed tet maps the escape vector to nonsense lengths)
    ct.depth = Math.min(wl, 1.5 * Math.sqrt(ex * ex + ey * ey + ez * ez)) + 0.002;
    return true;
  }

  _solvePieceCollisions(h) {
    const { x, px: q, w, T, tPiece, sTri } = this;
    const skip = this._skip, rel = this._pRel;
    this._pass++;
    const ct = this._ct;
    const pv = this._probeV, pf = this._probeF;
    const P = this.pieces, aw = this._awake;
    // probe = 1 vertex, or a face centre spread over 3 vertices
    const pi3 = this._pi3, pw3 = this._pw3, ti4 = this._ti4, tb4 = this._tb4;
    const cS = this._pcStart, cE = this._pcEnd;
    const wtV = this._wtV, wfV = this._wfV, wtF = this._wtF, wfF = this._wfF;
    const GP = this.grabs.length ? this._grabbedP : null, PP = this._pressP;
    let press = 0;
    const nProbes = this._nProbeV + this._nProbeF;
    for (let k = 0; k < nProbes; k++) {
      let n, own, cx, cy, cz, qx, qy, qz;
      if (k < this._nProbeV) {
        const i = pv[k], o = i * 3;
        n = 1;
        pi3[0] = i; pw3[0] = 1;
        own = this.vPiece[i];
        cx = x[o]; cy = x[o + 1]; cz = x[o + 2];
        qx = q[o]; qy = q[o + 1]; qz = q[o + 2];
      } else {
        const f = pf[k - this._nProbeV];
        n = 3;
        const a = sTri[f * 3], b = sTri[f * 3 + 1], c = sTri[f * 3 + 2];
        pi3[0] = a; pi3[1] = b; pi3[2] = c;
        pw3[0] = pw3[1] = pw3[2] = 1 / 3;
        own = tPiece[this.sTet[f]];
        cx = (x[a * 3] + x[b * 3] + x[c * 3]) / 3; cy = (x[a * 3 + 1] + x[b * 3 + 1] + x[c * 3 + 1]) / 3; cz = (x[a * 3 + 2] + x[b * 3 + 2] + x[c * 3 + 2]) / 3;
        qx = (q[a * 3] + q[b * 3] + q[c * 3]) / 3; qy = (q[a * 3 + 1] + q[b * 3 + 1] + q[c * 3 + 1]) / 3; qz = (q[a * 3 + 2] + q[b * 3 + 2] + q[c * 3 + 2]) / 3;
      }
      const isV = k < this._nProbeV;
      const key = isV ? pi3[0] : pf[k - this._nProbeV];
      const WT = isV ? wtV : wtF, WF = isV ? wfV : wfF;
      // closing speed bound (+ headroom for this frame's changes)
      const room = skip[k] - (rel[k] + 0.5) * h * 1.25;
      if (room > 0) {
        skip[k] = room;
        continue;
      }
      if (!this._contact(cx, cy, cz, qx, qy, qz, cS[k], cE[k], own, WT[key], WF[key])) {
        skip[k] = this._gap;
        continue;
      }
      skip[k] = 0;
      // (glued: its glue holds them - pushed apart as well, the two fought)
      if (this._glue && this._glue.has(own * 65536 + tPiece[ct.t])) continue;
      WT[key] = ct.t;
      WF[key] = ct.f;
      // (pressed into another piece - not its own walls touching inside it: a
      // tunnel through soft jelly sags shut against itself, and that had the
      // hand all but let go of a cube a few bullets had been through)
      if (GP && own !== tPiece[ct.t] && (GP[own] || GP[tPiece[ct.t]])) {
        if (ct.depth > press) press = ct.depth;
        // (per held piece: each hand eases off on its own)
        if (GP[own] && ct.depth > PP[own]) PP[own] = ct.depth;
        if (GP[tPiece[ct.t]] && ct.depth > PP[tPiece[ct.t]]) PP[tPiece[ct.t]] = ct.depth;
      }
      const t = ct.t, t4 = t * 4, d = ct.depth, pt = tPiece[t];
      // a real impact wakes sleepers - something moving into it, or pushed
      // well in - and otherwise a sleeping side is immovable (a neighbour
      // buzzing against it mustn't keep waking it)
      const po = P[own], pp = P[pt];
      // (pushed well in only by one itself going somewhere: in a pile of thin slices, sunk into each other,
      // one going nowhere - see _dampPieces - woke each one that slept, and none ever did)
      if (d > 0.003 && (po.asleep || pp.asleep)) {
        const pa = po.asleep ? pp : po, q = pa.vel;
        if ((d > 0.012 && pa.nwN === 0) || q[0] * q[0] + q[1] * q[1] + q[2] * q[2] > 0.08 * 0.08) {
          if (po.asleep) { po.asleep = false; po.sleepT = 0; aw[own] = 1; }
          if (pp.asleep) { pp.asleep = false; pp.sleepT = 0; aw[pt] = 1; }
        }
      }
      const mOwn = po.asleep ? 0 : 1, mTet = pp.asleep ? 0 : 1;
      ti4[0] = T[t4]; ti4[1] = T[t4 + 1]; ti4[2] = T[t4 + 2]; ti4[3] = T[t4 + 3];
      tb4[0] = ct.b0; tb4[1] = ct.b1; tb4[2] = ct.b2; tb4[3] = ct.b3;
      let wP = 0, wT = 0;
      for (let j = 0; j < n; j++) wP += pw3[j] * pw3[j] * w[pi3[j]];
      wP *= mOwn;
      for (let j = 0; j < 4; j++) wT += tb4[j] * tb4[j] * w[ti4[j]];
      wT *= mTet;
      const W = wP + wT;
      if (W <= 0) continue;
      const nx = ct.nx, ny = ct.ny, nz = ct.nz;
      // relative motion this substep (probe vs the point of the tet under it)
      let sx = cx - qx, sy = cy - qy, sz = cz - qz;
      for (let j = 0; j < 4; j++) {
        const i = ti4[j] * 3;
        sx -= tb4[j] * (x[i] - q[i]); sy -= tb4[j] * (x[i + 1] - q[i + 1]); sz -= tb4[j] * (x[i + 2] - q[i + 2]);
      }
      const sn = sx * nx + sy * ny + sz * nz;
      // gentle for resting contact, full strength when really penetrating
      const relax = d < 0.004 ? 0.5 : d > 0.02 ? 1 : 0.5 + ((d - 0.004) / 0.016) * 0.5;
      // (deep ones come out over a few substeps, not in one violent jump)
      const corr = Math.min(d * relax, 0.035 * this.p.size);
      // split: the part that cancels the approach may change velocity, the
      // rest is a pure position fix (contact must not inject bounce/jitter)
      const cv = Math.min(Math.max(-sn, 0), corr), cp = corr - cv;
      const lam = corr / W, lamP = cp / W;
      if (cv > 0) {
        // impulse (as m*dx) each side took from stopping the approach
        const J = cv / W, I = this._imp, pr = this._impPartner;
        if (mOwn) {
          const q = own * 12 + 8;
          I[q] += J; I[q + 1] += J * cx; I[q + 2] += J * cy; I[q + 3] += J * cz;
        }
        if (mTet) {
          const q = pt * 12 + 8;
          I[q] += J; I[q + 1] += J * cx; I[q + 2] += J * cy; I[q + 3] += J * cz;
        }
        pr[own] = pt;
        pr[pt] = own;
      }
      for (let j = 0; j < n; j++) {
        const i = pi3[j], s = w[i] * pw3[j] * mOwn;
        x[i * 3] += nx * s * lam; x[i * 3 + 1] += ny * s * lam; x[i * 3 + 2] += nz * s * lam;
        q[i * 3] += nx * s * lamP; q[i * 3 + 1] += ny * s * lamP; q[i * 3 + 2] += nz * s * lamP;
      }
      if (mTet) for (let j = 0; j < 4; j++) {
        const i = ti4[j], s = w[i] * tb4[j];
        x[i * 3] -= nx * s * lam; x[i * 3 + 1] -= ny * s * lam; x[i * 3 + 2] -= nz * s * lam;
        q[i * 3] -= nx * s * lamP; q[i * 3 + 1] -= ny * s * lamP; q[i * 3 + 2] -= nz * s * lamP;
      }
      // light friction on the sliding part of the relative motion
      sx -= sn * nx; sy -= sn * ny; sz -= sn * nz;
      const sl = Math.hypot(sx, sy, sz);
      if (sl > 1e-9) {
        const kf = (Math.min(1, (0.5 * this.p.contactGrip * d) / sl) * 0.7) / W;
        for (let j = 0; j < n; j++) {
          const i = pi3[j], s = w[i] * pw3[j] * mOwn * kf;
          x[i * 3] -= sx * s; x[i * 3 + 1] -= sy * s; x[i * 3 + 2] -= sz * s;
        }
        if (mTet) for (let j = 0; j < 4; j++) {
          const i = ti4[j], s = w[i] * tb4[j] * kf;
          x[i * 3] += sx * s; x[i * 3 + 1] += sy * s; x[i * 3 + 2] += sz * s;
        }
      }
    }
    this._grabPress = press;
  }

  // ---------------------------------------------------------------- queries
  // The jelly a line of sight passes close by, though it doesn't hit it (a
  // hole shot through along the line of sight: it passes clean through) - the
  // surface nearest it within maxD of it, in a piece whose box the line goes
  // through; the nearest of those along it. Shaped as raycast's hit; null if
  // none.
  pickNear(ox, oy, oz, dx, dy, dz, maxD) {
    const { x, sTri } = this, P = this.pieces, NP = P.length;
    const inBox = this._nearBox && this._nearBox.length >= NP ? this._nearBox : (this._nearBox = new Uint8Array(Math.max(NP, 64)));
    for (let k = 0; k < NP; k++) {
      const b = P[k].bbox;
      let t0 = 0, t1 = Infinity;
      for (let c = 0; c < 3 && t0 <= t1; c++) {
        const o = c === 0 ? ox : c === 1 ? oy : oz, d = c === 0 ? dx : c === 1 ? dy : dz;
        const lo = b[c] + 0.25 * maxD, hi = b[c + 3] - 0.25 * maxD;
        if (Math.abs(d) < 1e-12) {
          if (o < lo || o > hi) t0 = 1, t1 = 0;
          continue;
        }
        let a = (lo - o) / d, e = (hi - o) / d;
        if (a > e) [a, e] = [e, a];
        t0 = Math.max(t0, a);
        t1 = Math.min(t1, e);
      }
      inBox[k] = t0 <= t1 ? 1 : 0;
    }
    const m2 = maxD * maxD;
    let best = -1, bt = Infinity;
    for (let f = 0; f < this.nF; f++) {
      if (!inBox[this.tPiece[this.sTet[f]]]) continue;
      const a = sTri[f * 3] * 3, b = sTri[f * 3 + 1] * 3, c = sTri[f * 3 + 2] * 3;
      const cx = (x[a] + x[b] + x[c]) / 3 - ox, cy = (x[a + 1] + x[b + 1] + x[c + 1]) / 3 - oy, cz = (x[a + 2] + x[b + 2] + x[c + 2]) / 3 - oz;
      const t = cx * dx + cy * dy + cz * dz;
      if (t <= 0 || t >= bt) continue;
      const px = cx - dx * t, py = cy - dy * t, pz = cz - dz * t;
      if (px * px + py * py + pz * pz > m2) continue;
      best = f;
      bt = t;
    }
    if (best < 0) return null;
    const a = sTri[best * 3] * 3, b = sTri[best * 3 + 1] * 3, c = sTri[best * 3 + 2] * 3;
    const ux = x[b] - x[a], uy = x[b + 1] - x[a + 1], uz = x[b + 2] - x[a + 2];
    const vx = x[c] - x[a], vy = x[c + 1] - x[a + 1], vz = x[c + 2] - x[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    return {
      t: bt,
      point: [(x[a] + x[b] + x[c]) / 3, (x[a + 1] + x[b + 1] + x[c + 1]) / 3, (x[a + 2] + x[b + 2] + x[c + 2]) / 3],
      normal: [nx / l, ny / l, nz / l],
      face: best,
      piece: this.tPiece[this.sTet[best]],
      tet: this.sTet[best],
      bary: [1 / 3, 1 / 3, 1 / 3],
      near: true,
    };
  }

  // (skip: a piece to look straight through)
  raycast(ox, oy, oz, dx, dy, dz, maxT = Infinity, skip = -1) {
    const { x, sTri } = this;
    let best = maxT, bf = -1, bu = 0, bv = 0;
    for (let f = 0; f < this.nF; f++) {
      if (skip >= 0 && this.tPiece[this.sTet[f]] === skip) continue;
      const a = sTri[f * 3] * 3, b = sTri[f * 3 + 1] * 3, c = sTri[f * 3 + 2] * 3;
      const e1x = x[b] - x[a], e1y = x[b + 1] - x[a + 1], e1z = x[b + 2] - x[a + 2];
      const e2x = x[c] - x[a], e2y = x[c + 1] - x[a + 1], e2z = x[c + 2] - x[a + 2];
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (det > -1e-12 && det < 1e-12) continue;
      if (det < 0) continue; // only front faces (outward normals face the ray)
      const id = 1 / det;
      const tx = ox - x[a], ty = oy - x[a + 1], tz = oz - x[a + 2];
      const u = (tx * px + ty * py + tz * pz) * id;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * id;
      if (v < 0 || u + v > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * id;
      if (t > 1e-6 && t < best) {
        best = t;
        bf = f;
        bu = u;
        bv = v;
      }
    }
    if (bf < 0) return null;
    const a = sTri[bf * 3] * 3, b = sTri[bf * 3 + 1] * 3, c = sTri[bf * 3 + 2] * 3;
    const ux = x[b] - x[a], uy = x[b + 1] - x[a + 1], uz = x[b + 2] - x[a + 2];
    const vx = x[c] - x[a], vy = x[c + 1] - x[a + 1], vz = x[c + 2] - x[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    return {
      t: best,
      point: [ox + dx * best, oy + dy * best, oz + dz * best],
      normal: [nx / l, ny / l, nz / l],
      face: bf,
      piece: this.tPiece[this.sTet[bf]],
      tet: this.sTet[bf],
      bary: [1 - bu - bv, bu, bv],
    };
  }

  // Barycentric coordinates of p in tet t (current config). out[0..3]
  bary(t, px, py, pz, out) {
    const { x, T } = this;
    const a = T[t * 4] * 3, b = T[t * 4 + 1] * 3, c = T[t * 4 + 2] * 3, d = T[t * 4 + 3] * 3;
    const e1x = x[b] - x[a], e1y = x[b + 1] - x[a + 1], e1z = x[b + 2] - x[a + 2];
    const e2x = x[c] - x[a], e2y = x[c + 1] - x[a + 1], e2z = x[c + 2] - x[a + 2];
    const e3x = x[d] - x[a], e3y = x[d + 1] - x[a + 1], e3z = x[d + 2] - x[a + 2];
    const det = e1x * (e2y * e3z - e2z * e3y) - e2x * (e1y * e3z - e1z * e3y) + e3x * (e1y * e2z - e1z * e2y);
    if (Math.abs(det) < 1e-18) {
      out[0] = 1; out[1] = out[2] = out[3] = 0;
      return false;
    }
    const rx = px - x[a], ry = py - x[a + 1], rz = pz - x[a + 2];
    const id = 1 / det;
    const l1 = (rx * (e2y * e3z - e2z * e3y) - e2x * (ry * e3z - rz * e3y) + e3x * (ry * e2z - rz * e2y)) * id;
    const l2 = (e1x * (ry * e3z - rz * e3y) - rx * (e1y * e3z - e1z * e3y) + e3x * (e1y * rz - e1z * ry)) * id;
    const l3 = (e1x * (e2y * rz - e2z * ry) - e2x * (e1y * rz - e1z * ry) + rx * (e1y * e2z - e1z * e2y)) * id;
    out[0] = 1 - l1 - l2 - l3; out[1] = l1; out[2] = l2; out[3] = l3;
    return true;
  }

  // Locate the tet containing p (or the closest one). Returns {tet, bary, inside}.
  locate(px, py, pz, piece = -1) {
    const out = [0, 0, 0, 0];
    let bestT = -1, bestScore = -Infinity;
    const best = [0, 0, 0, 0];
    const list = piece >= 0 && this.pieces[piece] ? this.pieces[piece].tets : null;
    const n = list ? list.length : this.nT;
    for (let k = 0; k < n; k++) {
      const t = list ? list[k] : k;
      if (this.vol0[t] <= 0) continue;
      // quick reject by distance to first vertex
      const a = this.T[t * 4] * 3;
      const dx = this.x[a] - px, dy = this.x[a + 1] - py, dz = this.x[a + 2] - pz;
      if (dx * dx + dy * dy + dz * dz > 0.09) continue;
      this.bary(t, px, py, pz, out);
      const score = Math.min(out[0], out[1], out[2], out[3]);
      if (score > bestScore) {
        bestScore = score;
        bestT = t;
        best[0] = out[0]; best[1] = out[1]; best[2] = out[2]; best[3] = out[3];
        if (score >= 0) break;
      }
    }
    if (bestT < 0) return null;
    return { tet: bestT, bary: best, inside: bestScore >= -1e-6, score: bestScore };
  }

  // Rest-space grid of tets, for fast rest-coordinate lookups of many points
  // (glitter). Rebuilt lazily after topology changes.
  _restGrid() {
    if (this._rg && this._rg.v === this.topoVersion) return this._rg;
    const cs = this.hCell * 1.5, inv = 1 / cs;
    const T = this.T, X = this.X;
    const map = new Map();
    for (let t = 0; t < this.nT; t++) {
      if (this.vol0[t] <= 0) continue;
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let k = 0; k < 4; k++) {
        const i = T[t * 4 + k] * 3;
        x0 = Math.min(x0, X[i]); x1 = Math.max(x1, X[i]);
        y0 = Math.min(y0, X[i + 1]); y1 = Math.max(y1, X[i + 1]);
        z0 = Math.min(z0, X[i + 2]); z1 = Math.max(z1, X[i + 2]);
      }
      for (let a = Math.floor(x0 * inv); a <= Math.floor(x1 * inv); a++)
        for (let b = Math.floor(y0 * inv); b <= Math.floor(y1 * inv); b++)
          for (let c = Math.floor(z0 * inv); c <= Math.floor(z1 * inv); c++) {
            const key = (a + 512) * 1048576 + (b + 512) * 1024 + (c + 512);
            let l = map.get(key);
            if (!l) map.set(key, (l = []));
            l.push(t);
          }
    }
    this._rg = { v: this.topoVersion, map, inv };
    return this._rg;
  }

  // Fast rest-space point location: {tet, bary} or null.
  locateRestFast(X, Y, Z, out) {
    const g = this._restGrid();
    const key = (Math.floor(X * g.inv) + 512) * 1048576 + (Math.floor(Y * g.inv) + 512) * 1024 + (Math.floor(Z * g.inv) + 512);
    const list = g.map.get(key);
    if (!list) return null;
    const R = this.X, T = this.T, B = this.B;
    for (const t of list) {
      const a = T[t * 4] * 3, bo = t * 9;
      const rx = X - R[a], ry = Y - R[a + 1], rz = Z - R[a + 2];
      const l1 = B[bo] * rx + B[bo + 1] * ry + B[bo + 2] * rz;
      const l2 = B[bo + 3] * rx + B[bo + 4] * ry + B[bo + 5] * rz;
      const l3 = B[bo + 6] * rx + B[bo + 7] * ry + B[bo + 8] * rz;
      const l0 = 1 - l1 - l2 - l3;
      if (l0 >= -1e-7 && l1 >= -1e-7 && l2 >= -1e-7 && l3 >= -1e-7) {
        out.tet = t;
        out.b0 = l0; out.b1 = l1; out.b2 = l2; out.b3 = l3;
        return out;
      }
    }
    return null;
  }

  // Locate a point given in rest coordinates (used to re-seed embedded
  // features after the mesh is rebuilt).
  locateRest(X, Y, Z) {
    const R = this.X, T = this.T;
    for (let t = 0; t < this.nT; t++) {
      if (this.vol0[t] <= 0) continue;
      const a = T[t * 4] * 3, b = T[t * 4 + 1] * 3, c = T[t * 4 + 2] * 3, d = T[t * 4 + 3] * 3;
      const dx = R[a] - X, dy = R[a + 1] - Y, dz = R[a + 2] - Z;
      if (dx * dx + dy * dy + dz * dz > 0.06) continue;
      const bo = t * 9, B = this.B;
      const rx = X - R[a], ry = Y - R[a + 1], rz = Z - R[a + 2];
      const l1 = B[bo] * rx + B[bo + 1] * ry + B[bo + 2] * rz;
      const l2 = B[bo + 3] * rx + B[bo + 4] * ry + B[bo + 5] * rz;
      const l3 = B[bo + 6] * rx + B[bo + 7] * ry + B[bo + 8] * rz;
      const l0 = 1 - l1 - l2 - l3;
      if (l0 >= -1e-6 && l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6) return { tet: t, bary: [l0, l1, l2, l3] };
      void b; void c; void d;
    }
    return null;
  }

  embedPoint(t, b, out) {
    const { x, T } = this;
    let px = 0, py = 0, pz = 0;
    for (let k = 0; k < 4; k++) {
      const i = T[t * 4 + k] * 3;
      px += x[i] * b[k]; py += x[i + 1] * b[k]; pz += x[i + 2] * b[k];
    }
    out[0] = px; out[1] = py; out[2] = pz;
    return out;
  }

  embedVelocity(t, b, out) {
    const { v, T } = this;
    let px = 0, py = 0, pz = 0;
    for (let k = 0; k < 4; k++) {
      const i = T[t * 4 + k] * 3;
      px += v[i] * b[k]; py += v[i + 1] * b[k]; pz += v[i + 2] * b[k];
    }
    out[0] = px; out[1] = py; out[2] = pz;
    return out;
  }

  // Add velocity to vertices near p, falling off with distance.
  impulse(px, py, pz, dx, dy, dz, radius, strength, piece = -1) {
    const { x, v, w } = this;
    const r2 = radius * radius;
    let hit = 0;
    for (let i = 0; i < this.nV; i++) {
      if (w[i] === 0) continue;
      if (piece >= 0 && this.vPiece[i] !== piece) continue;
      const o = i * 3;
      const ex = x[o] - px, ey = x[o + 1] - py, ez = x[o + 2] - pz;
      const d2 = ex * ex + ey * ey + ez * ez;
      if (d2 > r2) continue;
      const f = 1 - Math.sqrt(d2) / radius;
      const s = strength * f * f;
      v[o] += dx * s; v[o + 1] += dy * s; v[o + 2] += dz * s;
      if (this.pieces[this.vPiece[i]].asleep) this.wake(this.vPiece[i]);
      hit++;
    }
    if (hit) this._hashDirty = true;
    return hit;
  }

  // A blast out from p (strongest at the centre, gone at radius) plus a
  // lift. rigid (0..1): how much each piece flies off as a whole instead of
  // being stretched by the blast's spread over it.
  radialImpulse(px, py, pz, radius, strength, up = 0, rigid = 0) {
    const { x, v, w } = this;
    this._hashDirty = true;
    // the chunks of a blast skip self-contact while they fly: tumbling and
    // torn about, every self probe would sweep through a lot of its own body
    // (the heaviest moments get heavier still), for nothing anyone could see
    this.selfQuietUntil = Math.max(this.selfQuietUntil, this.time + 0.5);
    const dv = rigid > 0 ? new Float64Array(this.nV * 3) : null;
    for (let i = 0; i < this.nV; i++) {
      if (w[i] === 0) continue;
      const o = i * 3;
      const ex = x[o] - px, ey = x[o + 1] - py, ez = x[o + 2] - pz;
      const d = Math.hypot(ex, ey, ez);
      if (d > radius || d < 1e-6) continue;
      const f = 1 - d / radius;
      const s = (strength * f * f) / d;
      const ux = ex * s, uy = ey * s + up * f, uz = ez * s;
      v[o] += ux; v[o + 1] += uy; v[o + 2] += uz;
      if (dv) { dv[o] = ux; dv[o + 1] = uy; dv[o + 2] = uz; }
      if (this.pieces[this.vPiece[i]].asleep) this.wake(this.vPiece[i]);
      this.pieces[this.vPiece[i]].touchT = this.time;
    }
    if (!dv) return;
    for (const pc of this.pieces) {
      let mx = 0, my = 0, mz = 0, M = 0;
      for (const i of pc.verts) {
        const mi = this.m[i];
        mx += dv[i * 3] * mi; my += dv[i * 3 + 1] * mi; mz += dv[i * 3 + 2] * mi;
        M += mi;
      }
      if (M <= 0) continue;
      mx /= M; my /= M; mz /= M;
      for (const i of pc.verts) {
        const o = i * 3;
        v[o] += rigid * (mx - dv[o]); v[o + 1] += rigid * (my - dv[o + 1]); v[o + 2] += rigid * (mz - dv[o + 2]);
      }
    }
  }

  // A bullet's temporary cavity (ballistic gel): along the segment a -> b,
  // the jelly round the path flung outward from it - strongest at the path,
  // gone at radius, fading along it as the bullet slows (strength at a, fade
  // x that at b) - and dragged a little along with it (along, m/s). The
  // jelly balloons round the wound and, its elasticity pulling it back,
  // collapses and wobbles.
  cavity(ax, ay, az, bx, by, bz, radius, strength, fade = 0.4, along = 0) {
    const { x, v, w } = this;
    this._hashDirty = true;
    this.selfQuietUntil = Math.max(this.selfQuietUntil, this.time + 0.4);
    const dx = bx - ax, dy = by - ay, dz = bz - az, L2 = dx * dx + dy * dy + dz * dz;
    if (L2 < 1e-12) return;
    const L = Math.sqrt(L2), ux = dx / L, uy = dy / L, uz = dz / L;
    for (let i = 0; i < this.nV; i++) {
      if (w[i] === 0) continue;
      const o = i * 3;
      const rx = x[o] - ax, ry = x[o + 1] - ay, rz = x[o + 2] - az;
      const s = Math.max(0, Math.min(1, (rx * dx + ry * dy + rz * dz) / L2));
      const px = rx - dx * s, py = ry - dy * s, pz = rz - dz * s;
      const d = Math.sqrt(px * px + py * py + pz * pz);
      if (d > radius) continue;
      const f = 1 - d / radius, k = strength * (1 - (1 - fade) * s) * f * f;
      const q = d > 1e-6 ? k / d : 0;
      v[o] += px * q + ux * along * f; v[o + 1] += py * q + uy * along * f; v[o + 2] += pz * q + uz * along * f;
      const pc = this.pieces[this.vPiece[i]];
      if (!pc) continue;
      if (pc.asleep) this.wake(this.vPiece[i]);
      pc.touchT = this.time;
    }
  }

  addHeat(px, py, pz, radius, amount, limitHi = 1.4, limitLo = -1.2) {
    const { x, temp } = this;
    const r2 = radius * radius;
    for (let i = 0; i < this.nV; i++) {
      if (!this.alive[i]) continue;
      const o = i * 3;
      const ex = x[o] - px, ey = x[o + 1] - py, ez = x[o + 2] - pz;
      const d2 = ex * ex + ey * ey + ez * ez;
      if (d2 > r2) continue;
      const f = 1 - Math.sqrt(d2) / radius;
      temp[i] = Math.max(limitLo, Math.min(limitHi, temp[i] + amount * f));
      if (this.pieces[this.vPiece[i]]?.asleep) this.wake(this.vPiece[i]);
    }
    this.heatActive = true;
    this._heatResidual = 1;
  }

  // the first hand (most callers only ever have one)
  get grab() {
    return this.grabs.length ? this.grabs[0] : null;
  }

  startGrab(hit, tx, ty, tz, radius = 0.2) {
    const { x } = this;
    const idx = [], wt = [], off = [];
    const [hx, hy, hz] = hit.point;
    for (const i of this.pieces[hit.piece].verts) {
      const o = i * 3;
      const ex = x[o] - hx, ey = x[o + 1] - hy, ez = x[o + 2] - hz;
      const d = Math.hypot(ex, ey, ez);
      if (d > radius) continue;
      const f = 1 - d / radius;
      idx.push(i);
      wt.push(Math.max(0.02, f * f));
      off.push(ex, ey, ez);
    }
    if (!idx.length) return null;
    this.wake(hit.piece);
    this._hashDirty = true;
    const g = {
      n: idx.length,
      idx: Int32Array.from(idx),
      wt: Float64Array.from(wt),
      off: Float64Array.from(off),
      tx, ty, tz,
      compliance: 2e-6,
      piece: hit.piece,
    };
    this.grabs.push(g);
    return g;
  }

  // Let go of one hand's grab (none given: all of them).
  endGrab(g) {
    if (g) {
      const k = this.grabs.indexOf(g);
      if (k >= 0) this.grabs.splice(k, 1);
    } else this.grabs.length = 0;
    this._hashDirty = true;
  }

  // Which pieces hands are holding (any piece with a held vertex: a tear can
  // leave one hand holding two), into _grabbedP; each grab's piece follows
  // its first live vertex.
  _markGrabbed() {
    const NP = this.pieces.length;
    const G = this._grabbedP && this._grabbedP.length >= NP ? this._grabbedP : (this._grabbedP = new Uint8Array(Math.max(NP, 64)));
    G.fill(0, 0, NP);
    for (let n = this.grabs.length - 1; n >= 0; n--) {
      const g = this.grabs[n];
      let first = -1;
      for (let j = 0; j < g.n; j++) {
        const k = this.vPiece[g.idx[j]];
        if (k < 0) continue;
        if (first < 0) first = k;
        G[k] = 1;
      }
      if (first < 0) this.grabs.splice(n, 1); // (all it held is gone)
      else g.piece = first;
    }
    return G;
  }

  totalVolume() {
    let s = 0;
    for (let t = 0; t < this.nT; t++) s += this.vol0[t];
    return s;
  }

  currentVolume() {
    const { x, T } = this;
    let s = 0;
    for (let t = 0; t < this.nT; t++) {
      if (this.vol0[t] <= 0) continue;
      const a = T[t * 4] * 3, b = T[t * 4 + 1] * 3, c = T[t * 4 + 2] * 3, d = T[t * 4 + 3] * 3;
      const e1x = x[b] - x[a], e1y = x[b + 1] - x[a + 1], e1z = x[b + 2] - x[a + 2];
      const e2x = x[c] - x[a], e2y = x[c + 1] - x[a + 1], e2z = x[c + 2] - x[a + 2];
      const e3x = x[d] - x[a], e3y = x[d + 1] - x[a + 1], e3z = x[d + 2] - x[a + 2];
      s += (e1x * (e2y * e3z - e2z * e3y) - e2x * (e1y * e3z - e1z * e3y) + e3x * (e1y * e2z - e1z * e2y)) / 6;
    }
    return s;
  }

  kineticEnergy() {
    let e = 0;
    for (let i = 0; i < this.nV; i++) {
      const o = i * 3;
      e += 0.5 * this.m[i] * (this.v[o] ** 2 + this.v[o + 1] ** 2 + this.v[o + 2] ** 2);
    }
    return e;
  }
}
