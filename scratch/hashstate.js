// the hash's state after a frame: its cell size against a mesh cell, how many probe against themselves, folded or not, entries a slot
await new Promise((r) => requestAnimationFrame(r));
const sb = __app.sb, P = sb.pieces, NP = P.length;
let flagged = 0;
for (let i = 0; i < sb.nV; i++) if (sb._selfFlag && sb._selfFlag[i] === 1) flagged++;
const size = (sb._hMask || 0) + 1, entries = sb._hCount ? sb._hCount[size] : 0;
// the sweep: its spread over the piece's vertices
const sw = sb._sweep, lens = [];
for (let i = 0; i < sb.nV; i++) {
  if (sb.vPiece[i] !== 0) continue;
  const r = i * 6;
  lens.push(Math.max(sw[r + 3] - sw[r], sw[r + 4] - sw[r + 1], sw[r + 5] - sw[r + 2]));
}
lens.sort((a, b) => a - b);
const q = (f) => +(lens[Math.min(lens.length - 1, Math.floor(f * lens.length))] / sb.hCell).toFixed(2);
return {
  hCell: +sb.hCell.toFixed(4), cellOverH: +((1 / sb._pcs[0]) / sb.hCell).toFixed(2),
  sweepOverH: { p50: q(0.5), p90: q(0.9), p99: q(0.99), max: q(1) },
  folded: P.map((p) => p.foldUntil > sb.time), hinge: P.map((p) => p.hinge), awake: P.map((p) => !p.asleep),
  selfFlagged: flagged, surfV: sb._nSurfV, slots: size, entries, perSlot: +(entries / size).toFixed(1), hashedTets: sb._nHTets, nT: sb.nT,
};
