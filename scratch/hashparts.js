// time the parts of the collision hash build for a few frames (wraps the body's own methods - fine for a look here)
const sb = __app.sb, T = {};
for (const n of ['_selfCheck', '_hashTets', '_gatherProbes', '_buildCollisionHash', '_solvePieceCollisions', '_contact']) {
  const f = sb[n].bind(sb);
  T[n] = { ms: 0, calls: 0 };
  sb[n] = (...a) => { const t = performance.now(); const r = f(...a); T[n].ms += performance.now() - t; T[n].calls++; return r; };
}
const frames = 4;
for (let k = 0; k < frames; k++) await new Promise((r) => requestAnimationFrame(r));
const P = sb.pieces;
return {
  tets: sb.nT, verts: sb.nV, surfFaces: sb.nF, pieces: P.length,
  hinge: P.map((p) => p.hinge), soft: P.map((p) => sb.cMu[p.cube]), selfOK: Array.from(sb._selfOK || []).slice(0, P.length),
  probesV: sb._nProbeV, probesF: sb._nProbeF, hashedTets: sb._nHTets, hashMask: sb._hMask, candidates: sb._nCand ?? null,
  perFrame: Object.fromEntries(Object.entries(T).map(([k, v]) => [k, { ms: +(v.ms / frames).toFixed(1), calls: Math.round(v.calls / frames) }])),
};
